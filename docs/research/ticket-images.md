# Images on tickets (WD-15)

Tickets often carry screenshots: a broken layout, an error dialog, a design to
match. Today Workdesk drops them along the way. This note covers where images
get lost, what each service allows, and a plan in three steps. The steps are
ordered by how much they help the agent, which is the point of a ticket in
Workdesk.

## Where images are lost today

| Step | What happens to an image | Where |
|---|---|---|
| Reading a ticket | GitHub and Linear keep the Markdown/HTML that references the image. ClickUp's `text_content` has the images removed. Every body is cut at 8,000 bytes, so images past that point are dropped. | `src-tauri/src/tickets.rs` (`github_issue`, `linear_tickets`, `clickup_task`, `cut`) |
| Showing a ticket | `![alt](url)` shows as a link button labelled with the alt text, or "image". GitHub's newer `<img src="…">` tags show as raw text, since the renderer only reads Markdown. | `src/markdown.ts` (`inline`) |
| Writing a ticket | The composer is a plain `<textarea>`. Pasting an image does nothing. Dropping one is caught by the window-level file-drop handler, which pastes into a terminal instead. | `src/home.ts` (`openComposer`), `src/filedrop.ts` |
| Handing to Claude | The brief is the body text. Image URLs reach Claude as text, and Claude can't open them: they need the user's login, and Claude has no token. | `src/sessions.ts` (`buildPrompt`, `ticketBlock`) |

## What each service allows

| | GitHub Issues | Linear | ClickUp | Workdesk (native) |
|---|---|---|---|---|
| How images sit in the body | `![](https://github.com/user-attachments/assets/<id>)`, or more often now `<img src="…user-attachments/assets/<id>">` | `![](https://uploads.linear.app/…)` | Images are task attachments. `text_content` strips them. `markdown_description` (opt-in per request) should keep them; this needs checking. | Nothing yet |
| Reading private images | The asset URL redirects to a JWT-signed `private-user-images.githubusercontent.com` URL when the request has `Authorization`. Asking for the issue with `Accept: application/vnd.github.full+json` returns `body_html` with those signed URLs already in it. They expire in about 5 minutes. Fine-grained PATs are reported to fail on the redirect, so the `body_html` route is safer. | Send the same `Authorization` header used for GraphQL, only to `*.linear.app` hosts. Signed URLs are also available, through the `public-file-urls-expire-in` header. | Attachment objects carry a URL. Whether it needs the token is unverified. | Local files |
| Uploading via API | **None.** Issue attachments can only be uploaded in the browser. The only API options are committing the image to the repo or hosting it elsewhere. | `fileUpload` mutation → PUT the bytes to the signed `uploadUrl` → reference `assetUrl` in the description | `POST /api/v2/task/{id}/attachment` (multipart, field `attachment`) after the task is created | Save to disk |

The GitHub, Linear and ClickUp rows come from community reports and docs, not
from tests against real accounts. The [sources](#sources) list them. Phase 1
should start by trying each service with a real ticket.

## How Claude would see them

Claude Code reads images from local files. Its Read tool accepts PNG, JPG and
other image formats, and a path in the prompt is enough for it to open the
file. So the agent needs **image files on disk, with their paths in the
brief**. It doesn't need URLs or base64. Workdesk already does this for
terminals: `filedrop.ts` saves dropped files with `save_drop` and pastes their
paths.

The images should live **beside the prompt file, not in the worktree**, under
`~/.workdesk/prompts/<repo>-<branch>/`. In the worktree, the agent might commit
them. `worktree_remove` already deletes the prompt file, so it can delete this
folder too.

## Plan

### Phase 1: Claude gets the ticket's images (biggest win)

1. **Backend: find the image references.** `tickets.rs` collects the image URLs
   in each body before `cut`, from both `![…](url)` and `<img src="url">`, and
   keeps them in a new `images: Vec<String>` on `Ticket`. For ClickUp, it asks
   for `include_markdown_description=true` and reads the attachments.
2. **Backend: new command `ticket_images(provider, id, urls, dir)`**, run as
   part of `worktree_start`. It downloads each image into
   `~/.workdesk/prompts/<repo>-<branch>/images/NN.<ext>`:
   - GitHub: fetch `body_html` for the issue first, then download its signed
     URLs right away, before they expire. Don't cache the signed URLs.
   - Linear: `Authorization: <key>`, sent only when the host ends in
     `.linear.app`.
   - Other hosts: download without credentials, or skip them (see open
     questions).
   - Limits: at most about 10 images and about 10 MB each. Check that the
     content type is `image/*`. A failure leaves out that one image and doesn't
     stop the session from starting.
3. **Brief:** `ticketBlock` adds an "Images" section that lists each local path
   with its alt text, and one line telling Claude to look at them before
   starting. `attachPrompt` gets the same section.

### Phase 2: show them in the ticket modal

- `markdown.ts` renders an image reference as a thumbnail, and reads
  `<img src>` too. Clicking the thumbnail opens it full size, or opens it in
  Preview.
- The webview can't load private images itself, because it has no token. The
  same backend downloader saves them to `~/.workdesk/cache/ticket-images/`,
  keyed by URL hash, and returns the bytes as a raw `tauri::ipc::Response`. The
  modal shows them from a `blob:` URL. This avoids turning on the asset
  protocol and its scope rules. `csp` is `null` today, so nothing blocks
  `blob:`.
- Only allow-listed hosts are fetched automatically (GitHub, Linear, ClickUp).
  An image from any other host stays a link until clicked, so opening a ticket
  can't trigger requests to arbitrary sites, such as tracking pixels.

### Phase 3: add images when writing a ticket

- **Workdesk tickets:** paste (⌘V) or drop an image into the composer. A new
  `save_attachment(ticket, name, bytes)` writes it to
  `~/.workdesk/attachments/<WD-n>/` and inserts
  `![name](~/.workdesk/attachments/WD-n/name)` at the cursor. Files go on disk,
  not into `localStorage`, because `localStorage` holds about 5 MB for every
  ticket together. Deleting a ticket deletes its folder once the Undo window
  has passed. Phase 1 then has nothing to download, since the paths are
  already local.
  - The composer's drop listener must call `preventDefault()`. `filedrop.ts`
    already skips events where that's set, so the image won't be pasted into a
    terminal too.
- **ClickUp:** create the task, then upload each image with the attachment
  endpoint. It appears as an attachment, not inline in the text.
- **GitHub:** there's no upload API, so images can't be posted with the issue.
  The options:
  1. Turn off pasting images in the composer when GitHub is picked, and tell
     the user why. *(Recommended to start.)*
  2. Commit the image to the repo, for example on a `workdesk-assets` branch,
     and link it. This changes the user's repo, so it would need to be opt-in.
  3. Create the issue, then open it in the browser so the user can drag the
     image in.
- **Linear:** isn't writable from the composer yet. When it is, `fileUpload`
  fits the same flow as ClickUp.

## Open questions (decisions for the user)

1. **Images from other hosts** (Imgur, S3 links, and so on): download them for
   Claude, or leave them as links? Downloading helps the agent, but it means
   Workdesk fetches URLs that someone else wrote into the ticket.
2. **GitHub images in the composer:** go with option 1 above (turn it off, say
   why), or is committing to the repo acceptable?
3. **Scope of the first build:** Phase 1 alone, or Phases 1 and 2 together?
   They share the downloader, so building both costs only a little more.

## Sources

- GitHub signed image URLs in `body_html`, and their ~5 minute expiry:
  [Medium: private-user-images when fetching GitHub bodies](https://medium.com/@junx.y/deal-with-private-user-images-githubusercontent-com-when-fetching-github-discussion-body-ef7920dc12d1),
  [connorads/dotfiles github-images skill](https://skillselion.com/skills/connorads/dotfiles/github-images)
- `user-attachments` redirects only with `Authorization`:
  [ReproJs commit b7e4a34](https://github.com/Ripwords/ReproJs/commit/b7e4a34)
- Fine-grained PATs and private attachments:
  [python-github-backup #478](https://github.com/josegonzalez/python-github-backup/pull/478/changes)
- Linear file auth and signed URLs:
  [Linear: file storage authentication](https://linear.app/developers/file-storage-authentication).
  Upload flow: [lineark-sdk helpers](https://docs.rs/crate/lineark-sdk/3.0.0/source/src/helpers.rs)
- ClickUp attachments:
  [Create Task Attachment](https://developer.clickup.com/reference/createtaskattachment),
  [Attachments](https://developer.clickup.com/docs/attachments)
