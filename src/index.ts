import { DurableObject } from "cloudflare:workers";

interface Transaction {
	id?: number;
	period: number;
	type: 'expense' | 'revenue';
	amount: number;
	inventory_change: number;
	description: string;
	created_at?: string;
}

interface PeriodSummary {
	period: number;
	starting_balance: number;
	total_expenses: number;
	total_revenue: number;
	ending_balance: number;
	starting_inventory: number;
	inventory_produced: number;
	inventory_sold: number;
	ending_inventory: number;
	unrealized_gains: number;
}

export class FinancialProjector extends DurableObject<Env> {
	sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS transactions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				period INTEGER NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('expense', 'revenue')),
				amount REAL NOT NULL,
				inventory_change INTEGER NOT NULL DEFAULT 0,
				description TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_transactions_period ON transactions(period);
		`);
	}

	addTransaction(transaction: Omit<Transaction, 'id' | 'created_at'>): Transaction {
		const cursor = this.sql.exec(`
			INSERT INTO transactions (period, type, amount, inventory_change, description)
			VALUES (?, ?, ?, ?, ?)
			RETURNING *
		`, 
			transaction.period,
			transaction.type,
			transaction.amount,
			transaction.inventory_change,
			transaction.description
		);

		return cursor.one() as Transaction;
	}

	getPeriodSummary(period: number): PeriodSummary {
		const cursor = this.sql.exec(`
			SELECT * FROM transactions WHERE period <= ? ORDER BY period, id
		`, period);
		
		const transactions = cursor.toArray() as Transaction[];

		let runningBalance = 0;
		let runningInventory = 0;
		let periodExpenses = 0;
		let periodRevenue = 0;
		let periodInventoryProduced = 0;
		let periodInventorySold = 0;

		// Calculate starting balances by processing all transactions before this period
		for (const tx of transactions) {
			if (tx.period < period) {
				runningBalance += tx.type === 'revenue' ? tx.amount : -tx.amount;
				runningInventory += tx.inventory_change;
			}
		}

		const startingBalance = runningBalance;
		const startingInventory = runningInventory;

		// Now process this period's transactions
		for (const tx of transactions) {
			if (tx.period === period) {
				if (tx.type === 'expense') {
					periodExpenses += tx.amount;
					if (tx.inventory_change > 0) periodInventoryProduced += tx.inventory_change;
				} else {
					periodRevenue += tx.amount;
					if (tx.inventory_change < 0) periodInventorySold += Math.abs(tx.inventory_change);
				}
				runningBalance += tx.type === 'revenue' ? tx.amount : -tx.amount;
				runningInventory += tx.inventory_change;
			}
		}

		const endingInventory = Math.max(0, runningInventory);
		const unrealizedGains = endingInventory * 500; // 500 MXN sale price per shirt

		return {
			period,
			starting_balance: period === 1 ? 0 : startingBalance,
			total_expenses: periodExpenses,
			total_revenue: periodRevenue,
			ending_balance: runningBalance,
			starting_inventory: period === 1 ? 0 : startingInventory,
			inventory_produced: periodInventoryProduced,
			inventory_sold: periodInventorySold,
			ending_inventory: endingInventory,
			unrealized_gains: unrealizedGains
		};
	}

	getTransactionsByPeriod(period: number): Transaction[] {
		const cursor = this.sql.exec(`
			SELECT * FROM transactions WHERE period = ? ORDER BY id ASC
		`, period);
		
		return cursor.toArray() as Transaction[];
	}

	getAllPeriodsWithTransactions(): Array<PeriodSummary & { transactions: Transaction[] }> {
		const cursor = this.sql.exec(`SELECT MAX(period) as max_period FROM transactions`);
		const result = cursor.toArray()[0] as { max_period: number | null };
		
		const maxPeriod = result?.max_period || 1;
		const periods: Array<PeriodSummary & { transactions: Transaction[] }> = [];

		for (let i = 1; i <= maxPeriod; i++) {
			const summary = this.getPeriodSummary(i);
			const transactions = this.getTransactionsByPeriod(i);
			periods.push({ ...summary, transactions });
		}

		return periods;
	}

	addSampleData(): string {
		// Clear existing data
		this.sql.exec(`DELETE FROM transactions`);
		
		// Period 1: Multiple transactions
		this.addTransaction({
			period: 1,
			type: 'expense',
			amount: 1000,
			inventory_change: 5,
			description: 'Manufacturing 5 shirts'
		});
		
		this.addTransaction({
			period: 1,
			type: 'revenue',
			amount: 500,
			inventory_change: -1,
			description: 'Sold 1 shirt online'
		});
		
		this.addTransaction({
			period: 1,
			type: 'revenue',
			amount: 500,
			inventory_change: -1,
			description: 'Sold 1 shirt at market'
		});
		
		this.addTransaction({
			period: 1,
			type: 'expense',
			amount: 240,
			inventory_change: 0,
			description: 'Shipping costs'
		});

		// Period 2: More complex
		this.addTransaction({
			period: 2,
			type: 'expense',
			amount: 1000,
			inventory_change: 5,
			description: 'Manufacturing batch 2'
		});
		
		this.addTransaction({
			period: 2,
			type: 'revenue',
			amount: 1000,
			inventory_change: -2,
			description: 'Wholesale order 2 shirts'
		});
		
		this.addTransaction({
			period: 2,
			type: 'revenue',
			amount: 1500,
			inventory_change: -3,
			description: 'Premium order 3 shirts'
		});
		
		this.addTransaction({
			period: 2,
			type: 'expense',
			amount: 120,
			inventory_change: 0,
			description: 'Packaging materials'
		});

		// Period 3: Simple
		this.addTransaction({
			period: 3,
			type: 'expense',
			amount: 240,
			inventory_change: 0,
			description: 'Marketing expenses'
		});
		
		return 'Sample data added successfully';
	}

	getAllPeriods(): PeriodSummary[] {
		const cursor = this.sql.exec(`SELECT MAX(period) as max_period FROM transactions`);
		const result = cursor.toArray()[0] as { max_period: number | null };
		
		const maxPeriod = result?.max_period || 1;
		const periods: PeriodSummary[] = [];

		for (let i = 1; i <= maxPeriod; i++) {
			periods.push(this.getPeriodSummary(i));
		}

		return periods;
	}
}

function getTshirtIcon(size: string = "16"): string {
	return `<svg width="${size}" height="${size}" viewBox="0 0 70.05 50.2" fill="currentColor" class="inline-block">
		<polygon points="70.05 30.2 51.87 0 43.46 0 35.03 5.43 26.6 0 18.19 0 0 30.2 16.99 28.26 11.71 47.06 35.03 50.2 58.34 47.06 53.06 28.26 70.05 30.2"/>
	</svg>`;
}

function generateTransactionBlock(transaction: Transaction, scaleFactor: number): string {
	const height = Math.max(40 * scaleFactor, transaction.amount * 0.05 * scaleFactor);
	const isRevenue = transaction.type === 'revenue';
	const bgColor = isRevenue ? 'bg-dark-green' : 'bg-custom-red';
	
	return `
		<div class="${bgColor} text-white p-2 rounded mb-1 relative flex flex-col justify-center items-center" 
			style="height: ${height}px">
			<div class="text-sm">${isRevenue ? '+' : ''}${transaction.amount.toLocaleString()}</div>
			<div class="text-xs opacity-75">${transaction.description}</div>
			${transaction.inventory_change !== 0 ? `
				<div class="absolute top-1 left-1 text-xs flex items-center">
					${transaction.inventory_change > 0 ? '+' : ''}${transaction.inventory_change}${getTshirtIcon("12")}
				</div>
			` : ''}
		</div>
	`;
}

function generateUnrealizedGainsBlock(period: PeriodSummary, scaleFactor: number): string {
	if (period.unrealized_gains <= 0) return '';
	
	const height = Math.max(30 * scaleFactor, period.unrealized_gains * 0.05 * scaleFactor);
	
	return `
		<div class="bg-light-green text-gray-800 p-2 rounded relative opacity-80 mb-1 flex flex-col justify-center items-center" 
			style="height: ${height}px">
			<div class="text-sm">${period.unrealized_gains.toLocaleString()}</div>
			<div class="absolute top-1 left-1 text-xs flex items-center">${period.ending_inventory}${getTshirtIcon("12")}</div>
		</div>
	`;
}

function calculateOptimalScaling(periods: Array<PeriodSummary & { transactions: Transaction[] }>): { scaleFactor: number; separatorPosition: number } {
	if (periods.length === 0) return { scaleFactor: 1, separatorPosition: 50 };
	
	// Calculate content heights for each period based on individual transactions
	const periodHeights = periods.map(period => {
		const revenueTransactions = period.transactions.filter(t => t.type === 'revenue');
		const expenseTransactions = period.transactions.filter(t => t.type === 'expense');
		
		const revenueHeight = revenueTransactions.reduce((sum, t) => 
			sum + Math.max(40, t.amount * 0.05) + 4, 0); // +4 for margin
		const expenseHeight = expenseTransactions.reduce((sum, t) => 
			sum + Math.max(40, t.amount * 0.05) + 4, 0); // +4 for margin
		const unrealizedHeight = period.unrealized_gains > 0 ? Math.max(30, period.unrealized_gains * 0.05) + 4 : 0;
		
		// Revenue section is sum of individual revenue blocks plus unrealized gains
		const revenueSection = revenueHeight + unrealizedHeight;
		const totalHeight = revenueSection + expenseHeight;
		
		return {
			revenueHeight: revenueSection,
			expenseHeight: expenseHeight,
			totalHeight: totalHeight
		};
	});
	
	// Find the maximum heights across all periods
	const maxRevenueHeight = Math.max(...periodHeights.map(p => p.revenueHeight));
	const maxExpenseHeight = Math.max(...periodHeights.map(p => p.expenseHeight));
	const maxTotalHeight = maxRevenueHeight + maxExpenseHeight;
	
	// Debug logging to understand the calculations
	console.log('Period heights:', periodHeights);
	console.log('Max revenue height:', maxRevenueHeight, 'Max expense height:', maxExpenseHeight);
	
	// Use 80% of container height as usable space (leaving room for padding)
	// Base heights: 400px desktop, 300px tablet, 240px mobile
	const usableHeight = 320; // 80% of 400px desktop - we'll scale down for smaller screens via CSS
	
	let scaleFactor = 1;
	if (maxTotalHeight > usableHeight) {
		scaleFactor = usableHeight / maxTotalHeight;
	}
	
	// Calculate optimal separator position based on content distribution
	const scaledRevenueHeight = maxRevenueHeight * scaleFactor;
	const scaledExpenseHeight = maxExpenseHeight * scaleFactor;
	const scaledTotalHeight = scaledRevenueHeight + scaledExpenseHeight;
	
	// Calculate separator position as percentage from top
	// Revenue section grows upward from separator, so separator position should favor the larger section
	let separatorPosition = 50; // default fallback
	
	if (scaledTotalHeight > 0) {
		// Base calculation: allocate space proportionally to content
		const basePosition = (scaledExpenseHeight / scaledTotalHeight) * 100;
		
		// Calculate the ratio between sections to determine how much to adjust
		const revenueRatio = scaledRevenueHeight / scaledTotalHeight;
		const expenseRatio = scaledExpenseHeight / scaledTotalHeight;
		
		// If one section is significantly larger, give it more space
		if (revenueRatio > 0.7) {
			// Revenue dominates - move separator down significantly
			separatorPosition = Math.min(75, basePosition + 15);
		} else if (expenseRatio > 0.7) {
			// Expenses dominate - move separator up significantly  
			separatorPosition = Math.max(25, basePosition - 15);
		} else {
			// More balanced - use proportional allocation with slight bias towards larger section
			const adjustment = (revenueRatio - expenseRatio) * 10; // Max 10% adjustment
			separatorPosition = basePosition - adjustment;
		}
		
		// Ensure separator stays within reasonable bounds (25% to 75%)
		separatorPosition = Math.max(25, Math.min(75, separatorPosition));
	}
	
	console.log('Final separator position:', separatorPosition + '%');
	return { scaleFactor, separatorPosition };
}

function generatePeriodColumns(periods: Array<PeriodSummary & { transactions: Transaction[] }>): string {
	if (periods.length === 0) {
		return `
			<div class="flex-shrink-0 bg-white rounded-lg shadow p-4 w-64 period-column">
				<h3 class="text-lg font-semibold mb-4 text-center">Period 1</h3>
				<div class="period-container">
					<div class="separator-line" style="top: 50%;"></div>
					<div class="text-center text-gray-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">No transactions yet</div>
				</div>
			</div>
		`;
	}

	const { scaleFactor, separatorPosition } = calculateOptimalScaling(periods);

	return periods.map(period => `
		<div class="flex-shrink-0 bg-white rounded-lg shadow p-4 w-64 period-column">
			<h3 class="text-lg font-semibold mb-4 text-center">Period ${period.period}</h3>
			
			<!-- Financial totals at top -->
			<div class="mb-4 text-center">
				${period.starting_balance !== 0 ? `<div class="text-sm text-gray-500">${period.starting_balance > 0 ? '+' : ''}${period.starting_balance.toLocaleString()}</div>` : ''}
				${period.total_revenue > 0 ? `<div class="text-dark-green">+${period.total_revenue.toLocaleString()}</div>` : ''}
				${period.total_expenses > 0 ? `<div class="text-custom-red">-${period.total_expenses.toLocaleString()}</div>` : ''}
				<div class="text-lg border-t pt-1 mt-1">${period.ending_balance > 0 ? '+' : ''}${period.ending_balance.toLocaleString()}</div>
			</div>

			<!-- Visual blocks container with smart separator -->
			<div class="period-container">
				<!-- Smart separator line positioned based on content -->
				<div class="separator-line" style="top: ${separatorPosition}%;"></div>
				
				<!-- Revenue section (grows upward from line) -->
				<div class="revenue-section" style="bottom: ${100 - separatorPosition}%;">
					<!-- Individual revenue transactions closest to middle line -->
					${period.transactions
						.filter(t => t.type === 'revenue')
						.map(transaction => generateTransactionBlock(transaction, scaleFactor))
						.join('')}
					
					<!-- Unrealized gains at the top (last element in the list) -->
					${generateUnrealizedGainsBlock(period, scaleFactor)}
				</div>

				<!-- Expense section (grows downward from line) -->
				<div class="expense-section" style="top: ${separatorPosition}%;">
					${period.transactions
						.filter(t => t.type === 'expense')
						.map(transaction => generateTransactionBlock(transaction, scaleFactor))
						.join('')}
				</div>
			</div>

			<!-- Inventory summary at bottom -->
			<div class="mt-4 pt-2 border-t text-center">
				${period.starting_inventory > 0 ? `<span class="text-gray-500 text-sm inline-flex items-center">${period.starting_inventory}${getTshirtIcon("16")}</span> ` : ''}
				${period.inventory_produced > 0 ? `<span class="text-custom-red text-sm inline-flex items-center">+${period.inventory_produced}${getTshirtIcon("16")}</span> ` : ''}
				${period.inventory_sold > 0 ? `<span class="text-dark-green text-sm inline-flex items-center">-${period.inventory_sold}${getTshirtIcon("16")}</span> ` : ''}
				<div class="inline-flex items-center justify-center">${period.ending_inventory}${getTshirtIcon("20")}</div>
			</div>

			<!-- Debug: Raw transaction data -->
			<div class="mt-4 pt-2 border-t text-xs text-gray-600">
				<div class="font-semibold mb-2">Transactions (${period.transactions.length}):</div>
				<div class="space-y-1">
					${period.transactions.map(t => {
						const isRevenue = t.type === 'revenue';
						const borderColor = isRevenue ? 'border-dark-green' : 'border-custom-red';
						const textColor = isRevenue ? 'text-dark-green' : 'text-custom-red';
						return `
							<div class="${textColor} ${borderColor} border px-2 py-1 rounded-sm text-xs">
								${isRevenue ? '+' : ''}$${t.amount} ${t.inventory_change !== 0 ? `(${t.inventory_change > 0 ? '+' : ''}${t.inventory_change} shirts)` : ''} - ${t.description}
							</div>
						`;
					}).join('')}
				</div>
			</div>
		</div>
	`).join('');
}

function generateJavaScript(): string {
	return `
		async function addTransaction() {
			const period = parseInt(document.getElementById('period').value);
			const type = document.getElementById('type').value;
			const amount = parseFloat(document.getElementById('amount').value);
			const inventory_change = parseInt(document.getElementById('inventory_change').value || '0');
			const description = document.getElementById('description').value;

			if (!period || !amount || !description) {
				alert('Please fill in all required fields');
				return;
			}

			try {
				const response = await fetch('/api/transaction', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						period,
						type,
						amount,
						inventory_change,
						description
					})
				});

				if (response.ok) {
					window.location.reload();
				} else {
					alert('Error adding transaction');
				}
			} catch (error) {
				alert('Error: ' + error.message);
			}
		}

		async function loadSampleData() {
			try {
				const response = await fetch('/api/sample-data', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' }
				});

				if (response.ok) {
					window.location.reload();
				} else {
					alert('Error loading sample data');
				}
			} catch (error) {
				alert('Error: ' + error.message);
			}
		}

		// Auto-update inventory change based on type
		document.getElementById('type').addEventListener('change', function() {
			const inventoryField = document.getElementById('inventory_change');
			if (this.value === 'expense') {
				inventoryField.placeholder = 'e.g., 5 (shirts produced)';
			} else {
				inventoryField.placeholder = 'e.g., -2 (shirts sold)';
			}
		});
	`;
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		const url = new URL(request.url);
		const id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName("projector");
		const stub = env.MY_DURABLE_OBJECT.get(id);

		if (url.pathname === '/api/transaction' && request.method === 'POST') {
			const transaction = await request.json<Omit<Transaction, 'id' | 'created_at'>>();
			const result = await stub.addTransaction(transaction);
			return Response.json(result);
		}

		if (url.pathname === '/api/periods') {
			const periods = await stub.getAllPeriods();
			return Response.json(periods);
		}

		if (url.pathname === '/api/periods-with-transactions') {
			const periods = await stub.getAllPeriodsWithTransactions();
			return Response.json(periods);
		}

		if (url.pathname === '/api/sample-data' && request.method === 'POST') {
			const result = await stub.addSampleData();
			return Response.json({ message: result });
		}

		if (url.pathname.startsWith('/api/period/')) {
			const period = parseInt(url.pathname.split('/')[3]);
			if (isNaN(period)) {
				return new Response('Invalid period', { status: 400 });
			}
			const summary = await stub.getPeriodSummary(period);
			return Response.json(summary);
		}

		if (url.pathname === '/tshirt-icon.svg') {
			return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_2" data-name="Layer 2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70.05 50.2">
  <defs>
    <style>
      .cls-1 {
        fill: currentColor;
      }
    </style>
  </defs>
  <g id="Layer_1-2" data-name="Layer 1">
    <polygon class="cls-1" points="70.05 30.2 51.87 0 43.46 0 35.03 5.43 26.6 0 18.19 0 0 30.2 16.99 28.26 11.71 47.06 35.03 50.2 58.34 47.06 53.06 28.26 70.05 30.2"/>
  </g>
</svg>`, {
				headers: { 'Content-Type': 'image/svg+xml' }
			});
		}

		// Serve the financial projector interface
		const periods = await stub.getAllPeriodsWithTransactions();
		
		return new Response(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>T-Shirt Financial Projector</title>
				<script src="https://cdn.tailwindcss.com"></script>
				<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<style>
					* {
						font-family: 'Montserrat', sans-serif;
						font-weight: bold;
					}
					
					.bg-dark-green {
						background-color: #006633;
					}
					
					.bg-light-green {
						background-color: #ccffcc;
					}
					
					.bg-custom-red {
						background-color: #cc3333;
					}
					
					.text-dark-green {
						color: #006633;
					}
					
					.text-custom-red {
						color: #cc3333;
					}
					
					.border-dark-green {
						border-color: #006633;
					}
					
					.border-custom-red {
						border-color: #cc3333;
					}
					
					.period-container {
						height: 400px;
						position: relative;
					}
					
					.separator-line {
						position: absolute;
						left: 0;
						right: 0;
						height: 2px;
						background-color: #1f2937;
						z-index: 10;
					}
					
					.revenue-section {
						position: absolute;
						left: 0;
						right: 0;
						display: flex;
						flex-direction: column-reverse;
						padding-bottom: 8px;
					}
					
					.expense-section {
						position: absolute;
						left: 0;
						right: 0;
						display: flex;
						flex-direction: column;
						padding-top: 8px;
					}
					
					
					@media (min-width: 1024px) {
						.period-container { height: 400px; }
					}
					
					@media (min-width: 768px) and (max-width: 1023px) {
						.period-container { height: 300px; }
					}
					
					@media (max-width: 767px) {
						.period-container { height: 240px; }
						.periods-wrapper {
							flex-direction: column !important;
							overflow-y: auto;
							max-height: 80vh;
						}
					}
					
					.periods-wrapper {
						scroll-behavior: smooth;
						scroll-snap-type: x mandatory;
					}
					
					.period-column {
						scroll-snap-align: start;
					}
				</style>
			</head>
			<body class="bg-gray-50 p-6">
				<div class="max-w-6xl mx-auto">
					<h1 class="text-3xl font-bold text-gray-800 mb-8">T-Shirt Financial Projector</h1>
					
					<!-- Period columns container -->
					<div class="flex gap-6 overflow-x-auto pb-6 periods-wrapper">
						${generatePeriodColumns(periods)}
					</div>
					
					<!-- Controls -->
					<div class="mt-8 bg-white rounded-lg shadow p-6">
						<h2 class="text-xl font-semibold mb-4">Add Transaction</h2>
						<form id="transaction-form" class="grid grid-cols-1 md:grid-cols-5 gap-4">
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-1">Period</label>
								<input type="number" id="period" min="1" value="${(periods.length || 0) + 1}" 
									class="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
							</div>
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
								<select id="type" class="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
									<option value="expense">Expense</option>
									<option value="revenue">Revenue</option>
								</select>
							</div>
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-1">Amount (MXN)</label>
								<input type="number" id="amount" min="0" step="0.01" 
									class="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
							</div>
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-1">Inventory Change</label>
								<input type="number" id="inventory_change" 
									class="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
							</div>
							<div>
								<label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
								<input type="text" id="description" placeholder="e.g., Manufacturing 5 shirts" 
									class="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
							</div>
						</form>
						<div class="mt-4 flex gap-3">
							<button onclick="addTransaction()" 
								class="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors">
								Add Transaction
							</button>
							<button onclick="loadSampleData()" 
								class="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors">
								Load Sample Data
							</button>
						</div>
					</div>
				</div>
				
				<script>
					${generateJavaScript()}
				</script>
			</body>
			</html>
		`, {
			headers: { 'Content-Type': 'text/html' }
		});
	},
} satisfies ExportedHandler<Env>;
