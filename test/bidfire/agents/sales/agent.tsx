// Fixture whose slug (`bidfire-sales`) differs from its folder (`sales`). Imports src/agent directly.

import { Agent } from "@pinecall/agents";

/** Eres el comercial de Bidfire. Hablas claro y no prometes descuentos. */
export default class BidfireSales extends Agent {
  override render(): string {
    return "Saluda y pregunta qué necesita.";
  }
}
