# Voice Over Studio

A lightweight video voice-over editor built as a browser-first MVP. The app lets you:

- upload a video directly from a phone or computer
- paste a YouTube URL as a reference source
- scrub through the clip with a timeline
- select a range to voice over
- record a voice line while the selected section plays
- place each recording as its own editable block on the timeline
- move, trim, delete, and re-record segments
- adjust original audio and voice-over volume
- preview the combined result in-browser
- export the mixed preview as a WebM file

## Local development

```bash
npm install
npm run dev
```

Then open the local URL printed in the terminal, usually `http://localhost:3000`.

## Notes

This is intentionally focused on the core editing workflow instead of a large media library or AI tooling. The video source is intentionally kept as an original asset while every voice-over is stored as a separate, editable timeline segment.

## Production build

```bash
npm run build
```

## Features in this first version

- direct media upload / phone capture support
- YouTube link loading for reference playback
- range-based timeline selection
- recording against selected moments
- multiple saved voice-over blocks
- per-block volume, trim, delete, and re-record controls
- mix preview controls
- export to a combined WebM preview

## Important implementation note

The MVP keeps the original media intact and preserves voice-over clips as independent timeline segments in the app state. The export action combines the visual/video playback with the saved voice clips in-browser for a downloadable preview.

## License

MIT
