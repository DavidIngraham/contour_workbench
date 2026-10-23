//! Small fixed-stroke lettering for dimensioned calibration parts.

/// Return horizontal pixel runs as `[x, y, width, height]` in millimeters.
/// Text reads left to right from above the build plate; origin is bottom left.
/// A caller-selected pixel size sets the minimum engraved stroke width.
pub fn coupon_text_rectangles(text: &str, pixel_mm: f64) -> Result<Vec<[f64; 4]>, String> {
    if !pixel_mm.is_finite() || !(0.4..=2.0).contains(&pixel_mm) || text.len() > 80 {
        return Err("Invalid coupon lettering size or length".into());
    }
    let mut rectangles = Vec::new();
    for (column, character) in text.chars().enumerate() {
        let rows = match character {
            '0' => [14, 17, 19, 21, 25, 17, 14],
            '1' => [4, 12, 4, 4, 4, 4, 14],
            '2' => [14, 17, 1, 2, 4, 8, 31],
            '3' => [30, 1, 1, 14, 1, 1, 30],
            '4' => [2, 6, 10, 18, 31, 2, 2],
            '5' => [31, 16, 16, 30, 1, 1, 30],
            '6' => [14, 16, 16, 30, 17, 17, 14],
            '7' => [31, 1, 2, 4, 8, 8, 8],
            '8' => [14, 17, 17, 14, 17, 17, 14],
            '9' => [14, 17, 17, 15, 1, 1, 14],
            'A' => [14, 17, 17, 31, 17, 17, 17],
            'C' => [14, 17, 16, 16, 16, 17, 14],
            'D' => [30, 17, 17, 17, 17, 17, 30],
            'E' => [31, 16, 16, 30, 16, 16, 31],
            'F' => [31, 16, 16, 30, 16, 16, 16],
            'G' => [14, 17, 16, 23, 17, 17, 15],
            'H' => [17, 17, 17, 31, 17, 17, 17],
            'I' => [14, 4, 4, 4, 4, 4, 14],
            'K' => [17, 18, 20, 24, 20, 18, 17],
            'L' => [16, 16, 16, 16, 16, 16, 31],
            'M' => [17, 27, 21, 21, 17, 17, 17],
            'N' => [17, 25, 25, 21, 19, 19, 17],
            'O' => [14, 17, 17, 17, 17, 17, 14],
            'P' => [30, 17, 17, 30, 16, 16, 16],
            'R' => [30, 17, 17, 30, 20, 18, 17],
            'S' => [15, 16, 16, 14, 1, 1, 30],
            'T' => [31, 4, 4, 4, 4, 4, 4],
            'U' => [17, 17, 17, 17, 17, 17, 14],
            'W' => [17, 17, 17, 21, 21, 21, 10],
            'Z' => [31, 1, 2, 4, 8, 16, 31],
            '.' => [0, 0, 0, 0, 0, 0, 4],
            '/' => [1, 2, 2, 4, 8, 8, 16],
            ' ' => [0; 7],
            _ => return Err(format!("Unsupported coupon character: {character}")),
        };
        for (row, bits) in rows.into_iter().enumerate() {
            let mut x = 0;
            while x < 5 {
                if bits & (1 << (4 - x)) == 0 {
                    x += 1;
                    continue;
                }
                let start = x;
                while x < 5 && bits & (1 << (4 - x)) != 0 {
                    x += 1;
                }
                rectangles.push([
                    (column * 6 + start) as f64 * pixel_mm,
                    (6 - row) as f64 * pixel_mm,
                    (x - start) as f64 * pixel_mm,
                    pixel_mm,
                ]);
            }
        }
    }
    Ok(rectangles)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_have_mm_strokes_and_read_from_above() {
        let dot = coupon_text_rectangles(".", 0.45).unwrap();
        assert_eq!(dot, vec![[0.9, 0.0, 0.45, 0.45]]);
        let label = coupon_text_rectangles("0.15 MM", 0.45).unwrap();
        assert!(label.iter().all(|r| r[2] >= 0.45 && r[3] == 0.45));
        assert!(label.iter().all(|r| r[0] + r[2] <= 18.45 + 1e-9));
        assert!(coupon_text_rectangles("?", 0.45).is_err());
        assert!(coupon_text_rectangles("MM", f64::NAN).is_err());
    }
}
