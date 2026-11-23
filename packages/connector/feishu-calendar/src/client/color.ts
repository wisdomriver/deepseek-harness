/** Map a Feishu calendar color onto the theme's eight calendar accents. */

/** Accents available in the theme; index 0 means the default brand color. */
export const CALENDAR_ACCENT_COUNT = 8

/** Saturation below which a color reads as neutral. */
const NEUTRAL_SATURATION = 0.12

/**
 * Choose one accent for a Feishu color value.
 * @param color - the signed ARGB integer Feishu reports, or undefined when absent.
 * @returns 1–8 for a colored value, or 0 for the default brand accent.
 */
export function calendarAccent(color: number | undefined): number {
  if (color === undefined || color === -1) return 0
  const unsigned = color >>> 0
  const red = (unsigned >>> 16) & 0xFF
  const green = (unsigned >>> 8) & 0xFF
  const blue = unsigned & 0xFF
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  if (max === 0) return 8
  if ((max - min) / max < NEUTRAL_SATURATION) return 8
  const hue = hueOf(red, green, blue, max, min)
  if (hue >= 340 || hue < 15) return 5
  if (hue < 50) return 4
  if (hue < 165) return 3
  if (hue < 200) return 2
  if (hue < 245) return 1
  if (hue < 305) return 6
  return 7
}

/**
 * Compute one color's hue in degrees.
 * @param red - red channel.
 * @param green - green channel.
 * @param blue - blue channel.
 * @param max - largest channel.
 * @param min - smallest channel.
 * @returns the hue between 0 and 360.
 */
function hueOf(red: number, green: number, blue: number, max: number, min: number): number {
  const delta = max - min
  if (delta === 0) return 0
  const raw = max === red
    ? ((green - blue) / delta) % 6
    : max === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4
  const degrees = raw * 60
  return degrees < 0 ? degrees + 360 : degrees
}
