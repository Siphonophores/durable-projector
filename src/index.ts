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
		const unrealizedGains = endingInventory * 400; // Assuming 400 MXN sale price per shirt

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

function generatePeriodColumns(periods: PeriodSummary[]): string {
	if (periods.length === 0) {
		return `
			<div class="flex-shrink-0 bg-white rounded-lg shadow p-4 w-64">
				<h3 class="text-lg font-semibold mb-4 text-center">Period 1</h3>
				<div class="text-center text-gray-500">No transactions yet</div>
			</div>
		`;
	}

	return periods.map(period => `
		<div class="flex-shrink-0 bg-white rounded-lg shadow p-4 w-64">
			<h3 class="text-lg font-semibold mb-4 text-center">Period ${period.period}</h3>
			
			<!-- Financial totals at top -->
			<div class="mb-4 text-center">
				${period.starting_balance !== 0 ? `<div class="text-sm text-gray-500">+${period.starting_balance.toLocaleString()}</div>` : ''}
				${period.total_revenue > 0 ? `<div class="text-green-600 font-medium">+${period.total_revenue.toLocaleString()}</div>` : ''}
				${period.total_expenses > 0 ? `<div class="text-red-600 font-medium">-${period.total_expenses.toLocaleString()}</div>` : ''}
				<div class="text-lg font-bold border-t pt-1 mt-1">${period.ending_balance.toLocaleString()}</div>
			</div>

			<!-- Visual blocks container -->
			<div class="relative min-h-64 flex flex-col justify-end">
				<!-- Revenue blocks (green) -->
				${period.total_revenue > 0 ? `
					<div class="bg-green-500 text-white p-2 rounded mb-1 relative" 
						style="height: ${Math.max(40, period.total_revenue * 0.05)}px">
						<div class="text-xs">Revenue</div>
						<div class="text-sm font-bold">${period.total_revenue.toLocaleString()}</div>
						${period.inventory_sold > 0 ? `<div class="absolute top-1 left-1 text-xs flex items-center">-${period.inventory_sold}${getTshirtIcon("12")}</div>` : ''}
					</div>
				` : ''}

				<!-- Dark separator line -->
				<div class="border-b-2 border-gray-800 my-2"></div>

				<!-- Expense blocks (red) -->
				${period.total_expenses > 0 ? `
					<div class="bg-red-500 text-white p-2 rounded mb-1 relative" 
						style="height: ${Math.max(40, period.total_expenses * 0.05)}px">
						<div class="text-xs">Expenses</div>
						<div class="text-sm font-bold">${period.total_expenses.toLocaleString()}</div>
						${period.inventory_produced > 0 ? `<div class="absolute top-1 left-1 text-xs flex items-center">+${period.inventory_produced}${getTshirtIcon("12")}</div>` : ''}
					</div>
				` : ''}

				<!-- Unrealized gains (light green) -->
				${period.unrealized_gains > 0 ? `
					<div class="bg-green-300 text-gray-800 p-2 rounded relative" 
						style="height: ${Math.max(30, period.unrealized_gains * 0.05)}px">
						<div class="text-xs">Unrealized</div>
						<div class="text-sm font-bold">${period.unrealized_gains.toLocaleString()}</div>
						<div class="absolute top-1 left-1 text-xs flex items-center">${period.ending_inventory}${getTshirtIcon("12")}</div>
					</div>
				` : ''}
			</div>

			<!-- Inventory summary at bottom -->
			<div class="mt-4 pt-2 border-t text-center">
				${period.starting_inventory > 0 ? `<span class="text-gray-500 text-sm inline-flex items-center">${period.starting_inventory}${getTshirtIcon("16")}</span> ` : ''}
				${period.inventory_produced > 0 ? `<span class="text-red-600 text-sm inline-flex items-center">+${period.inventory_produced}${getTshirtIcon("16")}</span> ` : ''}
				${period.inventory_sold > 0 ? `<span class="text-green-600 text-sm inline-flex items-center">-${period.inventory_sold}${getTshirtIcon("16")}</span> ` : ''}
				<div class="font-bold inline-flex items-center justify-center">${period.ending_inventory}${getTshirtIcon("20")}</div>
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
		const periods = await stub.getAllPeriods();
		
		return new Response(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>T-Shirt Financial Projector</title>
				<script src="https://cdn.tailwindcss.com"></script>
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<style>
					.block-height { height: calc(var(--amount) * 0.1px); min-height: 40px; }
					.shirt-icon::before { content: '👕'; }
				</style>
			</head>
			<body class="bg-gray-50 p-6">
				<div class="max-w-6xl mx-auto">
					<h1 class="text-3xl font-bold text-gray-800 mb-8">T-Shirt Financial Projector</h1>
					
					<!-- Period columns container -->
					<div class="flex gap-6 overflow-x-auto pb-6">
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
						<button onclick="addTransaction()" 
							class="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors">
							Add Transaction
						</button>
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
