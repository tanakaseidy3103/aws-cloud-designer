# Cloud Architecture Designer

A modern web application for designing AWS cloud architectures with drag-and-drop simplicity. Built with Next.js 15, TypeScript, TailwindCSS, and React Flow.

## Features

- **Drag & Drop** — Add AWS components (EC2, S3, RDS, Lambda, Load Balancer, CloudFront) to the canvas
- **Connections** — Link components with animated arrows to visualize data flow
- **Edit & Move** — Reposition nodes and edit properties (name, description, region, instance type)
- **Save & Load** — Persist architectures locally in the browser
- **Export PNG** — Download your architecture diagram as a high-resolution image
- **Modern UI** — Dark theme inspired by AWS Console and Figma

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
├── app/              # Next.js App Router pages and layout
├── components/       # React components
│   ├── canvas/       # Main React Flow canvas
│   ├── modals/       # Load architecture modal
│   ├── nodes/        # Custom AWS node components
│   ├── panels/       # Properties panel
│   ├── sidebar/      # AWS services palette
│   └── toolbar/      # Top toolbar actions
├── lib/              # Utilities, storage, export, AWS definitions
└── types/            # TypeScript type definitions
```

## Future-Ready Architecture

The codebase is structured to support upcoming features:

- **AWS S3 Integration** — `lib/storage.ts` includes placeholder S3 sync methods
- **Cost Estimation** — Types defined in `types/architecture.ts`
- **Team Collaboration** — Session types ready for real-time sync
- **Terraform Generation** — Output types prepared for IaC export

## Tech Stack

- [Next.js 15](https://nextjs.org/)
- [React Flow (@xyflow/react)](https://reactflow.dev/)
- [TailwindCSS 4](https://tailwindcss.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Lucide Icons](https://lucide.dev/)
- [html-to-image](https://github.com/bubkoo/html-to-image)

## License

MIT
