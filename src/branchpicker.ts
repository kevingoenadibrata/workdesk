import { Check, GitBranch, Plus, icon } from "./icons";

/** What the user picked: an existing branch, or a new one to create from HEAD. */
export type BranchChoice = { branch: string; create: boolean };

let current: { root: HTMLElement; close: () => void } | null = null;

export function closeBranchPicker() {
  current?.close();
}

/** Whether `name` could be a new branch; git itself rejects whatever else is wrong with it. */
function plausibleBranchName(name: string): boolean {
  return name !== "" && !name.startsWith("-") && !/\s/.test(name);
}

/**
 * A searchable branch list opening upwards from `anchor`, with `currentBranch`
 * first. Typing a name that matches no branch offers to create it.
 */
export function openBranchPicker(
  anchor: HTMLElement,
  branches: string[],
  currentBranch: string,
  onPick: (choice: BranchChoice) => void,
  onCancel: () => void,
) {
  closeBranchPicker();
  const ordered = [...branches.filter((b) => b === currentBranch), ...branches.filter((b) => b !== currentBranch)];

  const root = document.createElement("div");
  root.className = "menu branch-picker";
  const input = document.createElement("input");
  input.className = "branch-search";
  input.type = "text";
  input.placeholder = "Search branches…";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search branches");
  const list = document.createElement("div");
  list.className = "branch-list";
  root.append(input, list);

  let choices: BranchChoice[] = [];
  let active = 0;

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll(".menu-item").forEach((el, j) => el.classList.toggle("active", j === i));
    list.children[i]?.scrollIntoView({ block: "nearest" });
  };

  const render = () => {
    const query = input.value.trim();
    const q = query.toLowerCase();
    // Branches starting with the query come before ones that merely contain it.
    const matches = q
      ? ordered
          .filter((b) => b.toLowerCase().includes(q))
          .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
      : ordered;
    choices = matches.map((branch) => ({ branch, create: false }));
    if (query && plausibleBranchName(query) && !branches.includes(query)) choices.push({ branch: query, create: true });

    list.replaceChildren(
      ...choices.map((c, i) => {
        const b = document.createElement("button");
        b.className = "menu-item";
        const isCurrent = !c.create && c.branch === currentBranch;
        b.append(icon(c.create ? Plus : isCurrent ? Check : GitBranch, 13, "menu-icon"));
        const label = document.createElement("span");
        label.className = "menu-label";
        label.textContent = c.create ? `Create new branch "${c.branch}"` : c.branch;
        b.append(label);
        b.addEventListener("mousemove", () => active !== i && highlight(i));
        b.addEventListener("click", () => pick(i));
        return b;
      }),
    );
    if (choices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "menu-heading";
      empty.textContent = "No matching branches";
      list.append(empty);
    }
    highlight(0);
  };

  const pick = (i: number) => {
    const choice = choices[i];
    if (!choice) return;
    close(false);
    onPick(choice);
  };

  const onOutside = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close(true);
  };
  const close = (cancelled: boolean) => {
    if (current?.root !== root) return;
    current = null;
    window.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("blur", onBlur);
    root.remove();
    if (cancelled) onCancel();
  };
  const onBlur = () => close(true);

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (choices.length) highlight((active + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  });
  // Keep focus in the search box while clicking the list.
  list.addEventListener("mousedown", (e) => e.preventDefault());

  render();
  document.body.append(root);
  const a = anchor.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  root.style.left = `${Math.max(4, Math.min(a.left, innerWidth - r.width - 4))}px`;
  root.style.top = `${Math.max(4, a.top - r.height - 6)}px`;
  current = { root, close: () => close(true) };
  window.addEventListener("mousedown", onOutside, true);
  window.addEventListener("blur", onBlur);
  input.focus();
}
