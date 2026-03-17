import postgres from "npm:postgres@3.4.4";

type ApplyRequest = {
  sql?: string;
  version?: string;
  name?: string;
  transaction?: boolean;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });

const unauthorized = () => json(401, { ok: false, error: "unauthorized" });

const decodeJwtPayload = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getHistoryInsertSql = (columns: string[], version: string, name: string) => {
  if (columns.includes("statements") && columns.includes("name")) {
    return {
      text: `
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values ($1, $2, $3::text[])
        on conflict (version) do nothing
      `,
      args: [version, name, []],
    };
  }

  if (columns.includes("name")) {
    return {
      text: `
        insert into supabase_migrations.schema_migrations (version, name)
        values ($1, $2)
        on conflict (version) do nothing
      `,
      args: [version, name],
    };
  }

  return {
    text: `
      insert into supabase_migrations.schema_migrations (version)
      values ($1)
      on conflict (version) do nothing
    `,
    args: [version],
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const jwtPayload = bearerToken ? decodeJwtPayload(bearerToken) : null;
  const role = typeof jwtPayload?.role === "string" ? jwtPayload.role : null;

  if (role !== "service_role") {
    return unauthorized();
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
  if (!dbUrl) {
    return json(500, { ok: false, error: "missing_db_url_secret" });
  }

  let body: ApplyRequest;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json_body" });
  }

  const sqlText = body.sql?.trim();
  if (!sqlText) {
    return json(400, { ok: false, error: "missing_sql" });
  }

  const version = body.version?.trim() || null;
  const name = body.name?.trim() || "manual_apply";
  const useTransaction = body.transaction !== false;

  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 15,
  });

  try {
    const migrationColumns = await sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'supabase_migrations'
        and table_name = 'schema_migrations'
      order by ordinal_position
    `;
    const columnNames = migrationColumns.map((row) => row.column_name);

    if (version) {
      const existing = await sql<{ version: string }[]>`
        select version
        from supabase_migrations.schema_migrations
        where version = ${version}
        limit 1
      `;

      if (existing.length > 0) {
        return json(200, {
          ok: true,
          alreadyApplied: true,
          version,
          migrationHistoryColumns: columnNames,
        });
      }
    }

    let queryResult: unknown = null;

    const runApply = async (db: ReturnType<typeof postgres>) => {
      queryResult = await db.unsafe(sqlText);

      if (version) {
        const historyInsert = getHistoryInsertSql(columnNames, version, name);
        await db.unsafe(historyInsert.text, historyInsert.args);
      }
    };

    if (useTransaction) {
      await sql.begin(async (tx) => {
        await runApply(tx);
      });
    } else {
      await runApply(sql);
    }

    return json(200, {
      ok: true,
      alreadyApplied: false,
      version,
      transaction: useTransaction,
      migrationHistoryColumns: columnNames,
      result: Array.isArray(queryResult) ? queryResult : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, {
      ok: false,
      error: "sql_apply_failed",
      details: message,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
