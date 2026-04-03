# AAC Symbol Kitchen

A web-based tool for speech therapists, parents, and AAC users to search for AAC symbols, combine them into a scene, and generate a communication card with AI.

**Live:** https://sigiho.github.io/aac-symbol/

---

## How it works

1. Search for AAC symbols in Korean or English (powered by ARASAAC API)
2. Click up to 3 symbols to select them
3. Click **✦ Generate Image** — Gemini composes a natural sentence and generates a pictogram
4. Download the card as PNG

## Tech stack

- Vanilla JavaScript, HTML, CSS — no frameworks, no build tools
- Tailwind CSS via CDN
- [ARASAAC REST API](https://api.arasaac.org) — symbol search
- Gemini 2.5 Flash — Korean sentence composition
- Gemini 2.5 Flash Image — AAC pictogram generation
- HTML5 Canvas API — card rendering and export

## Setup

This is a static site — open `index.html` directly in a browser or serve with any static server.

A Gemini API key is required for image generation. Get one free at [aistudio.google.com](https://aistudio.google.com).

Enter the key via the **⚙ API Key** button in the app. It is stored in `localStorage` only and never committed to the repository.
