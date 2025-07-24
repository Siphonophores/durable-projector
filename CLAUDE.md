# T-Shirt Financial Projector

## Project Overview
A visual financial planning tool for a T-shirt startup that uses Cloudflare Durable Objects to demonstrate period-based financial modeling with inventory tracking. This project serves dual purposes:
1. Learning Cloudflare Durable Objects with SQLite backend
2. Creating a practical business visualization tool using quantized financial blocks

## Business Model
- **Product**: T-shirts at 500 MXN sale price each
- **Manufacturing**: Purchased in batches of 5 shirts for 1000 MXN (200 MXN cost per shirt)
- **Shipping**: 240 MXN per sale transaction
- **Profit margin**: 300 MXN per shirt (500 sale - 200 cost)

## Visual Quantization System
The app uses **1000 MXN blocks** as the standard unit for visual representation:

### Block Types
1. **Red blocks (Expenses)**
   - Standard 1k block = 5 shirts manufactured (1000 MXN)
   - Quarter-height block = shipping costs (240 MXN)
   - Height scales proportionally: 240/1000 = 0.24x standard height

2. **Dark green blocks (Revenue)**
   - Standard 1k block = 2 shirts sold (2 × 500 MXN = 1000 MXN)
   - Creates visual parity with manufacturing costs

3. **Light green blocks (Unrealized Gains)**
   - NOT transactions - calculated UI visualization
   - Shows current inventory value at sale price (shirts × 500 MXN)
   - Appears in same period as corresponding purchase
   - Helps entrepreneurs visualize "what if I sold all remaining inventory"

### Height Scaling
- Base unit: 1000 MXN = 1x standard block height
- 240 MXN shipping = 0.24x height (quarter-height)
- Unrealized gains scale linearly: N shirts × 500 MXN / 1000 = height multiplier

## Example Scenario

### Period 1
**Transactions:**
- Manufacturing: 1000 MXN, +5 shirts (red 1k block)
- Sales: 1000 MXN, -2 shirts (dark green 1k block) 
- Shipping: 240 MXN (red quarter-height block)

**Result:**
- Cash flow: -240 MXN (1000 revenue - 1000 cost - 240 shipping)
- Inventory: 3 shirts remaining
- Unrealized gains: 1500 MXN (light green 1.5x block)

### Period 2
**Transactions:**
- Manufacturing: 1000 MXN, +5 shirts (red 1k block)
- Sales: 2000 MXN, -4 shirts (2 dark green 1k blocks)
- Shipping: 480 MXN (2 red quarter-height blocks)

**Result:**
- Starting inventory: 3 shirts
- Ending inventory: 3 + 5 - 4 = 4 shirts
- Unrealized gains: 2000 MXN (light green 2x block)

### Period 3
**Transactions:**
- Manufacturing: 1000 MXN, +5 shirts (red 1k block)
- Sales: 1000 MXN, -2 shirts (dark green 1k block)
- Shipping: 240 MXN (red quarter-height block)

**Result:**
- Starting inventory: 4 shirts
- Ending inventory: 4 + 5 - 2 = 7 shirts
- Unrealized gains: 3500 MXN (light green 3.5x block)

## Technical Architecture

### Durable Objects Backend
- **Class**: `FinancialProjector` extends `DurableObject<Env>`
- **Storage**: SQLite database with transactions table
- **Methods**: `addTransaction()`, `getPeriodSummary()`, `getAllPeriods()`

### Database Schema
```sql
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period INTEGER NOT NULL,
    type TEXT CHECK (type IN ('expense', 'revenue')),
    amount REAL NOT NULL,
    inventory_change INTEGER DEFAULT 0,
    description TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### API Endpoints
- `POST /api/transaction` - Add new transaction
- `GET /api/periods` - Get all period summaries
- `GET /api/period/[number]` - Get specific period summary
- `GET /tshirt-icon.svg` - T-shirt icon asset

### Frontend
- **Framework**: Vanilla HTML/CSS/JavaScript with Tailwind CSS
- **Icons**: Custom SVG t-shirt icon (avoiding emoji corruption)
- **Layout**: Horizontal period columns with proportional block heights
- **Interactions**: Form-based transaction entry with real-time updates

## Key Features
✅ **Period-based financial modeling** with running totals  
✅ **Visual block representation** with proportional heights  
✅ **Inventory tracking** across periods  
✅ **Unrealized gains visualization** for business planning  
✅ **Real-time calculations** with SQLite persistence  
✅ **Responsive design** with Tailwind CSS  
✅ **SVG icons** for clean t-shirt indicators  

## Development Commands
- `npm run dev` - Start local development server
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run cf-typegen` - Generate TypeScript types

## Learning Outcomes
This project demonstrates:
- Durable Objects with SQLite storage backend
- Period-based financial calculations with running totals
- Visual data representation with proportional scaling
- Business logic separation (transactions vs. calculated UI elements)
- Real-time web application with persistent state