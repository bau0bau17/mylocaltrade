---
name: OpenAPI nullable references
description: Generator compatibility rule for nullable object references in the shared API specification.
---

Use a non-nullable component schema for an object, then mark the *property*
nullable with an `allOf` reference when the API may return `null`.

**Why:** Orval emits invalid TypeScript when `nullable: true` is placed on an
object component that it renders as an interface.

**How to apply:** When adding a nullable DTO object to the shared OpenAPI
contract, regenerate the clients and type-check the generated React client;
never hand-edit generated output.