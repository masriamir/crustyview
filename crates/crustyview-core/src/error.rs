//! User-facing messages for WAD load failures.
//!
//! Since crustywad 0.9.4 (crustywad#416), every `ParseError` variant's
//! `Display` is a clean single line — the `Header`/`Directory` variants no
//! longer embed `binrw`'s multi-line ANSI backtrace report — so
//! [`load_error_message`] is a plain sanitize passthrough. `sanitize` stays
//! as defense-in-depth: it strips ANSI escapes, control characters, and
//! extra lines in case a future crustywad release regresses a `Display`
//! implementation. It is shared crate-wide — `map2d` routes its user-facing
//! messages through it too (#46).

use crustywad::ParseError;

/// A short, single-line, ANSI-free message describing why a WAD failed to
/// load, suitable for direct display to the user.
#[must_use]
pub fn load_error_message(err: &ParseError) -> String {
    sanitize(&err.to_string())
}

/// First line only, ANSI escape sequences and control characters removed,
/// trimmed.
pub(crate) fn sanitize(message: &str) -> String {
    let first_line = message.lines().next().unwrap_or_default();
    let mut out = String::with_capacity(first_line.len());
    let mut chars = first_line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            skip_escape_sequence(&mut chars);
        } else if !c.is_control() {
            out.push(c);
        }
    }
    out.trim().to_owned()
}

/// Consume the remainder of an ANSI escape sequence whose ESC was just read:
/// CSI (`[` up to a final byte in `@`..`~`), OSC (`]` up to `BEL` or the
/// `ESC \` string terminator), an nF sequence (intermediate bytes in
/// space..`/` then one final byte), or a single-character escape.
fn skip_escape_sequence(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    match chars.next() {
        Some('[') => {
            for c in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&c) {
                    break;
                }
            }
        }
        Some(']') => {
            while let Some(c) = chars.next() {
                if c == '\u{7}' || (c == '\u{1b}' && chars.next_if_eq(&'\\').is_some()) {
                    break;
                }
            }
        }
        Some(c) if ('\u{20}'..='\u{2f}').contains(&c) => {
            for c in chars.by_ref() {
                if !('\u{20}'..='\u{2f}').contains(&c) {
                    break;
                }
            }
        }
        // A single-character escape (or a trailing bare ESC): nothing more to
        // consume beyond the character just read.
        _ => {}
    }
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

    // The next two assertions now pin crustywad 0.9.4's own `Display` wording
    // end-to-end — crustywad#416 adopted exactly the strings this module's
    // hand-written arms used to produce. An upstream rewording should fail
    // here rather than silently change the error banner.
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
    fn sanitize_drops_a_trailing_escape() {
        assert_eq!(sanitize("az\u{1b}"), "az");
    }

    #[test]
    fn sanitize_strips_osc_sequences() {
        assert_eq!(sanitize("a\u{1b}]0;title\u{7}z"), "az"); // BEL-terminated
        assert_eq!(sanitize("a\u{1b}]0;title\u{1b}\\z"), "az"); // ST-terminated
    }

    #[test]
    fn sanitize_strips_charset_and_single_char_escapes() {
        assert_eq!(sanitize("a\u{1b}(Bz"), "az"); // nF charset selection
        assert_eq!(sanitize("a\u{1b}Mz"), "az"); // single-character escape
    }

    #[test]
    fn sanitize_drops_stray_control_characters() {
        assert_eq!(sanitize("a\u{7}z"), "az");
    }

    #[test]
    fn sanitize_survives_unterminated_sequences() {
        assert_eq!(sanitize("a\u{1b}]0;title"), "a"); // OSC, no terminator
        assert_eq!(sanitize("a\u{1b}( "), "a"); // nF, no final byte
        assert_eq!(sanitize("a\u{1b}[31"), "a"); // CSI, no final byte
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
