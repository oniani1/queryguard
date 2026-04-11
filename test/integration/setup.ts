import pg from 'pg'

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:spike@localhost:5432/spike'

export async function createClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  return client
}
