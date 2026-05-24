## PDF Password Remover

This is a JavaScript [Next.js](https://nextjs.org) web app for removing a PDF password when the current password is already known.

The app works completely in the browser:

- Loads the protected PDF with the provided password
- Renders each page locally on the device
- Generates a new PDF without the original password prompt
- Avoids sending the file to a custom backend

## Important behavior

- This tool requires the correct current password
- It does not guess, crack, or bypass unknown passwords
- The exported PDF is rebuilt from rendered pages, so forms, selectable text, annotations, and other interactive elements may be flattened

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build for production

```bash
npm run build
```

## Deploy on Vercel

1. Push this project to GitHub, GitLab, or Bitbucket
2. Import the repository into [Vercel](https://vercel.com/new)
3. Vercel will detect it as a Next.js project automatically
4. Deploy with the default settings

No custom server configuration is required.

## Tech notes

- Framework: Next.js App Router
- Language: JavaScript
- Processing model: client-side in the browser
- Runtime target: Vercel-compatible static/web app deployment

## Project structure

- `src/app/page.js`: main interface and client-side PDF processing flow
- `src/app/layout.js`: app metadata
- `src/app/globals.css`: global styling

## Notes for future improvements

- Add drag-and-drop upload
- Add progress details for large files
- Add optional page range export
- Replace CDN-loaded browser libraries with bundled dependencies if the local npm issue is resolved
