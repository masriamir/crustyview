//! User-facing messages for WAD load failures.
//!
//! `crustywad::ParseError`'s `Display` embeds `binrw`'s multi-line ANSI
//! backtrace report for the `Header` and `Directory` variants (crustywad#416),
//! which is unfit for an error banner. [`load_error_message`] maps those two
//! variants to short single-line messages and sanitizes everything else in
//! case a future crustywad release changes a `Display` implementation.

use crustywad::ParseError;

/// A short, single-line, ANSI-free message describing why a WAD failed to
/// load, suitable for direct display to the user.
#[must_use]
pub fn load_error_message(err: &ParseError) -> String {
    match err {
        // Header and Directory wrap a `binrw::Error` whose `Display` is the
        // multi-line report; their fixed fields can only fail on early EOF.
        ParseError::Header(_) => "failed to parse WAD header: unexpected end of input".to_owned(),
        ParseError::Directory { index, .. } => {
            format!("failed to parse WAD directory entry {index}: unexpected end of input")
        }
        other => sanitize(&other.to_string()),
    }
}

/// First line only, ANSI escape sequences removed, trimmed.
fn sanitize(message: &str) -> String {
    let first_line = message.lines().next().unwrap_or_default();
    let mut out = String::with_capacity(first_line.len());
    let mut chars = first_line.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        // Skip a CSI sequence: ESC '[' parameters, then one final byte in @..~.
        if chars.peek() == Some(&'[') {
            chars.next();
            for after in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&after) {
                    break;
                }
            }
        }
    }
    out.trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crustywad::Wad;

    fn load_err(bytes: &[u8]) -> ParseError {
        Wad::from_bytes(bytes.to_vec()).expect_err("expected parse failure")
    }

    /// Header bytes with the given lump count and directory offset.
    fn header(numlumps: i32, infotableofs: i32) -> Vec<u8> {
        let mut v = b"PWAD".to_vec();
        v.extend_from_slice(&numlumps.to_le_bytes());
        v.extend_from_slice(&infotableofs.to_le_bytes());
        v
    }

    #[test]
    fn truncated_header_maps_to_single_clean_line() {
        let msg = load_error_message(&load_err(&[0u8; 9]));
        assert_eq!(msg, "failed to parse WAD header: unexpected end of input");
    }

    #[test]
    fn truncated_directory_maps_to_single_clean_line() {
        let err = ParseError::Directory {
            index: 3,
            source: binrw::Error::Io(std::io::Error::from(std::io::ErrorKind::UnexpectedEof)),
        };
        assert_eq!(
            load_error_message(&err),
            "failed to parse WAD directory entry 3: unexpected end of input"
        );
    }

    #[test]
    fn sanitize_strips_ansi_and_keeps_first_line() {
        assert_eq!(
            sanitize("bad \u{1b}[1mnews\u{1b}[22m \nsecond line"),
            "bad news"
        );
    }

    #[test]
    fn sanitize_leaves_clean_messages_unchanged() {
        assert_eq!(
            sanitize("invalid WAD magic `NOPE`"),
            "invalid WAD magic `NOPE`"
        );
    }

    #[test]
    fn invalid_magic_passes_through() {
        let msg = load_error_message(&load_err(b"NOPE12345678"));
        assert_eq!(msg, "invalid WAD magic `NOPE`");
    }

    #[test]
    fn out_of_bounds_directory_passes_through_unchanged() {
        let err = load_err(&header(1, 1000));
        assert_eq!(load_error_message(&err), err.to_string());
    }

    #[test]
    fn negative_numlumps_passes_through_unchanged() {
        let err = load_err(&header(-1, 12));
        assert_eq!(load_error_message(&err), err.to_string());
    }
}
