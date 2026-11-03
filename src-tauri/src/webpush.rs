//! Web Push (RFC 8030) for the phone mirror's home-screen app: VAPID-signed
//! (RFC 8292), with the payload encrypted for the phone (RFC 8291, aes128gcm),
//! so the push service only ever sees ciphertext. Built on ring, which rustls
//! already brings in.

use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD as B64},
    Engine,
};
use ring::{
    aead, agreement, hkdf,
    rand::{SecureRandom, SystemRandom},
    signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING},
};
use serde::{Deserialize, Serialize};

/// Who push services can contact about this sender (RFC 8292 `sub`); Apple requires one.
const SUBJECT: &str = "https://github.com/kevingoenadibrata/workdesk";
/// Record size in the aes128gcm header. One record holds the whole payload.
const RECORD_SIZE: u32 = 4096;

/// A phone that asked for notifications, as `PushSubscription.toJSON()` gives it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Subscription {
    pub endpoint: String,
    pub keys: Keys,
    /// Which phone it is, for Settings.
    #[serde(default)]
    pub device: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Keys {
    pub p256dh: String,
    pub auth: String,
}

/// The key Workdesk signs pushes with. Phones subscribe with its public half.
pub struct Vapid {
    key: EcdsaKeyPair,
}

fn err(_: impl std::fmt::Debug) -> String {
    "Couldn't encrypt the notification.".into()
}

impl Vapid {
    /// Loads the key from `path`, making one (readable only by you) the first time.
    pub fn load_or_create(path: &Path) -> Result<Self, String> {
        let rng = SystemRandom::new();
        let pkcs8 = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => {
                let doc = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).map_err(err)?;
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                }
                write_private(path, doc.as_ref())?;
                doc.as_ref().to_vec()
            }
        };
        let key = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &pkcs8, &rng)
            .map_err(|_| "The notification key is damaged.".to_string())?;
        Ok(Self { key })
    }

    /// The public key in the form `pushManager.subscribe` takes (`applicationServerKey`).
    pub fn public_key(&self) -> String {
        B64.encode(self.key.public_key().as_ref())
    }

    /// The `Authorization` header for a push to a service at `audience` (its scheme and host).
    fn authorization(&self, audience: &str) -> Result<String, String> {
        let exp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs() + 12 * 3600;
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = B64.encode(serde_json::json!({ "aud": audience, "exp": exp, "sub": SUBJECT }).to_string());
        let msg = format!("{header}.{claims}");
        let sig = self.key.sign(&SystemRandom::new(), msg.as_bytes()).map_err(err)?;
        Ok(format!("vapid t={msg}.{}, k={}", B64.encode(sig.as_ref()), self.public_key()))
    }
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Browsers send base64url without padding, but some add it or use the standard alphabet.
fn decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim().trim_end_matches('=');
    B64.decode(s).ok().or_else(|| URL_SAFE.decode(s).ok()).or_else(|| STANDARD.decode(s).ok())
}

struct Len(usize);
impl hkdf::KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> Result<Vec<u8>, String> {
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, salt).extract(ikm);
    let info = [info];
    let okm = prk.expand(&info, Len(len)).map_err(err)?;
    let mut out = vec![0; len];
    okm.fill(&mut out).map_err(err)?;
    Ok(out)
}

/// Encrypts `payload` for `sub` as one aes128gcm record (RFC 8291 §3.4, RFC 8188).
pub fn encrypt(sub: &Subscription, payload: &[u8]) -> Result<Vec<u8>, String> {
    let ua_public = decode(&sub.keys.p256dh).filter(|k| k.len() == 65).ok_or("The phone's key is malformed.")?;
    let auth = decode(&sub.keys.auth).filter(|k| k.len() == 16).ok_or("The phone's key is malformed.")?;
    let rng = SystemRandom::new();

    let ephemeral = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng).map_err(err)?;
    let as_public = ephemeral.compute_public_key().map_err(err)?.as_ref().to_vec();
    let shared = agreement::agree_ephemeral(
        ephemeral,
        &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, &ua_public),
        |s| s.to_vec(),
    )
    .map_err(|_| "The phone's key is malformed.".to_string())?;

    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(&ua_public);
    key_info.extend_from_slice(&as_public);
    let ikm = hkdf(&auth, &shared, &key_info, 32)?;

    let mut salt = [0u8; 16];
    rng.fill(&mut salt).map_err(err)?;
    let cek = hkdf(&salt, &ikm, b"Content-Encoding: aes128gcm\0", 16)?;
    let nonce = hkdf(&salt, &ikm, b"Content-Encoding: nonce\0", 12)?;

    let key = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_128_GCM, &cek).map_err(err)?);
    let mut record = payload.to_vec();
    record.push(2); // Padding delimiter: this is the last record.
    if record.len() + 16 > RECORD_SIZE as usize {
        return Err("The notification is too long.".into());
    }
    key.seal_in_place_append_tag(
        aead::Nonce::try_assume_unique_for_key(&nonce).map_err(err)?,
        aead::Aad::empty(),
        &mut record,
    )
    .map_err(err)?;

    let mut body = Vec::with_capacity(16 + 4 + 1 + 65 + record.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend_from_slice(&as_public);
    body.extend_from_slice(&record);
    Ok(body)
}

/// What the push service said.
pub enum Sent {
    Ok,
    /// The phone unsubscribed or the subscription expired: forget it.
    Gone,
    Failed(String),
}

pub async fn send(client: &reqwest::Client, vapid: &Vapid, sub: &Subscription, payload: &[u8]) -> Sent {
    let Ok(url) = reqwest::Url::parse(&sub.endpoint) else { return Sent::Gone };
    if url.scheme() != "https" {
        return Sent::Gone;
    }
    let audience = url.origin().ascii_serialization();
    let (auth, body) = match (vapid.authorization(&audience), encrypt(sub, payload)) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => return Sent::Failed(e),
    };
    let res = client
        .post(url)
        .header("TTL", "86400")
        .header("Urgency", "high")
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .header("Authorization", auth)
        .body(body)
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => Sent::Ok,
        Ok(r) if matches!(r.status().as_u16(), 404 | 410) => Sent::Gone,
        Ok(r) => {
            let status = r.status();
            let text = r.text().await.unwrap_or_default();
            Sent::Failed(format!("Push service said {status}: {}", text.trim()))
        }
        Err(e) => Sent::Failed(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_FIXED};

    /// Decrypts as the phone would (RFC 8291 from the receiving side), to check `encrypt`.
    #[test]
    fn phone_can_decrypt() {
        let rng = SystemRandom::new();
        let ua = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng).unwrap();
        let ua_public = ua.compute_public_key().unwrap().as_ref().to_vec();
        let mut auth = [0u8; 16];
        rng.fill(&mut auth).unwrap();
        let sub = Subscription {
            endpoint: "https://web.push.apple.com/x".into(),
            keys: Keys { p256dh: B64.encode(&ua_public), auth: B64.encode(auth) },
            device: None,
        };
        let msg = br#"{"title":"Claude needs you"}"#;
        let body = encrypt(&sub, msg).unwrap();

        let (salt, rest) = body.split_at(16);
        assert_eq!(u32::from_be_bytes(rest[..4].try_into().unwrap()), RECORD_SIZE);
        let idlen = rest[4] as usize;
        let as_public = &rest[5..5 + idlen];
        let mut record = rest[5 + idlen..].to_vec();

        let shared = agreement::agree_ephemeral(
            ua,
            &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, as_public),
            |s| s.to_vec(),
        )
        .unwrap();
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(&ua_public);
        info.extend_from_slice(as_public);
        let ikm = hkdf(&auth, &shared, &info, 32).unwrap();
        let cek = hkdf(salt, &ikm, b"Content-Encoding: aes128gcm\0", 16).unwrap();
        let nonce = hkdf(salt, &ikm, b"Content-Encoding: nonce\0", 12).unwrap();
        let key = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_128_GCM, &cek).unwrap());
        let plain = key
            .open_in_place(aead::Nonce::try_assume_unique_for_key(&nonce).unwrap(), aead::Aad::empty(), &mut record)
            .unwrap();
        assert_eq!(plain.last(), Some(&2));
        assert_eq!(&plain[..plain.len() - 1], msg);
    }

    #[test]
    fn vapid_token_verifies() {
        let dir = std::env::temp_dir().join(format!("wd-vapid-{}", std::process::id()));
        let path = dir.join("vapid.pk8");
        let _ = std::fs::remove_file(&path);
        let vapid = Vapid::load_or_create(&path).unwrap();
        // Loading again gives the same key.
        assert_eq!(Vapid::load_or_create(&path).unwrap().public_key(), vapid.public_key());
        let header = vapid.authorization("https://web.push.apple.com").unwrap();
        let token = header.strip_prefix("vapid t=").unwrap().split(',').next().unwrap();
        let (signed, sig) = token.rsplit_once('.').unwrap();
        let public = B64.decode(vapid.public_key()).unwrap();
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, public)
            .verify(signed.as_bytes(), &B64.decode(sig).unwrap())
            .unwrap();
        let claims: serde_json::Value = serde_json::from_slice(&B64.decode(signed.split('.').nth(1).unwrap()).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://web.push.apple.com");
        let _ = std::fs::remove_dir_all(dir);
    }
}
