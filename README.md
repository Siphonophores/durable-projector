# T-Shirt Financial Projector

A visual financial planning tool for T-shirt startups built with Cloudflare Durable Objects. This app demonstrates period-based financial modeling using quantized visual blocks to help entrepreneurs understand cash flow, inventory, and unrealized gains.

![T-Shirt Financial Projector Interface](https://img.shields.io/badge/status-active-brightgreen)

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Visit http://localhost:8787
```

## 🎯 What It Does

Transform complex financial data into intuitive visual blocks:

- **Red blocks**: Manufacturing costs and expenses (proportional height)
- **Dark green blocks**: Sales revenue from shirts sold
- **Light green blocks**: Unrealized gains from unsold inventory
- **Period columns**: Weekly/monthly financial snapshots

## 💡 Key Features

- **Visual Quantization**: 1k MXN = 1 standard block height for easy comparison
- **Inventory Tracking**: Real-time calculation of shirts in stock
- **Unrealized Gains**: Visualize potential value of unsold inventory  
- **Period Analysis**: Running totals across multiple time periods
- **Persistent Storage**: Powered by Cloudflare Durable Objects with SQLite

## 🏗️ Tech Stack

- **Backend**: Cloudflare Durable Objects with SQLite
- **Frontend**: HTML/CSS/JavaScript with Tailwind CSS
- **Icons**: Custom SVG graphics
- **Deployment**: Cloudflare Workers

## 📊 Business Model

- **T-shirt sale price**: 500 MXN each
- **Manufacturing cost**: 200 MXN each (bought in batches of 5)
- **Shipping cost**: 240 MXN per transaction
- **Profit margin**: 300 MXN per shirt

## 🔧 Development

```bash
# Generate TypeScript types
npm run cf-typegen

# Deploy to Cloudflare
npm run deploy

# Local development with hot reload
npm run dev
```

## 📖 Documentation

See [CLAUDE.md](./CLAUDE.md) for detailed technical documentation, business logic, and example scenarios.

## 🎨 Visual Design

The interface uses proportional block heights to create an intuitive financial dashboard:

- Manufacturing expense (1k MXN) = Standard red block
- Shipping cost (240 MXN) = Quarter-height red block  
- Sales revenue (1k MXN) = Standard green block
- Unrealized gains = Light green block (varies by inventory)

## 🚀 Deployment

This app is designed to run on Cloudflare Workers with Durable Objects:

1. Configure your Cloudflare account
2. Run `npm run deploy`
3. Access your deployed app at the provided URL

## 🤝 Contributing

This project was built as a learning exercise for Cloudflare Durable Objects. Feel free to fork and experiment!

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Built with ❤️ using Cloudflare Durable Objects**