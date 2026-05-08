// NOTE: orval's codegen overwrites this file on regen. If `pnpm --filter
// @workspace/api-spec run codegen` reintroduces an `export * from
// "./generated/types";` line below, drop it again — that types/ barrel
// duplicates names already exported by the zod schemas in ./generated/api
// (e.g. HandleStripeWebhookBody) and produces TS2308 ambiguous-export
// errors. Consumers of this package only need the zod schemas; the
// TypeScript types live in @workspace/api-client-react.
export * from "./generated/api";
