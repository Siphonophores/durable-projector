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

		// Serve basic HTML for now
		return new Response(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>T-Shirt Financial Projector</title>
				<script src="https://cdn.tailwindcss.com"></script>
			</head>
			<body class="bg-gray-100 p-8">
				<h1 class="text-2xl font-bold mb-4">T-Shirt Financial Projector</h1>
				<p class="mb-4">Durable Object is running!</p>
				<div class="space-y-2">
					<p><strong>API Endpoints:</strong></p>
					<ul class="list-disc list-inside space-y-1">
						<li>POST /api/transaction - Add a transaction</li>
						<li>GET /api/periods - Get all period summaries</li>
						<li>GET /api/period/[number] - Get specific period summary</li>
					</ul>
				</div>
			</body>
			</html>
		`, {
			headers: { 'Content-Type': 'text/html' }
		});
	},
} satisfies ExportedHandler<Env>;
