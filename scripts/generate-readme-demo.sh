#!/usr/bin/env bash
set -euo pipefail

# Regenerate the README's 20-second terminal walkthrough. Requires macOS sips
# for SVG rasterization and ffmpeg for GIF encoding.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output="$repo_root/assets/pmem-session-demo.gif"

for dependency in node sips ffmpeg; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "$dependency is required to generate the README demo." >&2
    exit 1
  fi
done

mkdir -p "$repo_root/assets"
frame_dir="$(node "$repo_root/scripts/generate-readme-demo.mjs")"

for frame in 0 1 2 3 4; do
  sips -s format png "$frame_dir/$frame.svg" --out "$frame_dir/$frame.png" >/dev/null
done

ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -framerate 8 -t 4 -i "$frame_dir/0.png" \
  -loop 1 -framerate 8 -t 4 -i "$frame_dir/1.png" \
  -loop 1 -framerate 8 -t 4 -i "$frame_dir/2.png" \
  -loop 1 -framerate 8 -t 4 -i "$frame_dir/3.png" \
  -loop 1 -framerate 8 -t 4 -i "$frame_dir/4.png" \
  -filter_complex "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0,fps=8,split[video][palette_source];[palette_source]palettegen=stats_mode=diff[palette];[video][palette]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$output"

echo "Generated $output"
