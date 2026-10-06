/**
 * Canonical Prisma string-search filter for this MySQL deployment.
 *
 * MySQL compatibility (root cause of the `Unknown argument 'mode'`
 * PrismaClientValidationError): Prisma's `mode: 'insensitive'` string-filter
 * flag is a PostgreSQL/MongoDB feature — the MySQL connector's generated
 * client rejects it at validation time (`mode` does not exist on
 * `StringFilter` for MySQL models). Case-insensitivity for MySQL is provided
 * by the column/table collation instead: every table in this schema's
 * migrations is created `utf8mb4_unicode_ci`, and `_ci` collations make
 * `LIKE '%term%'` (Prisma `contains`) case-insensitive by definition.
 *
 * Therefore the ONLY correct case-insensitive `contains` filter here is a
 * plain `{ contains: term }`. Always search through this helper so the
 * collation contract stays documented in one place; never re-add `mode`.
 */
export function containsCI(contains: string): { contains: string } {
  return { contains }
}
