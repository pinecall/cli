// Fixture agent loaded through tsx by the CLI loader. Imports src/agent directly: no dist exists yet.

import { Agent } from "@pinecall/agents";

/** Eres la recepción de Clínica Norte. Hablas de usted, con frases cortas. */
export default class ClinicaNorte extends Agent {
  patient?: { name: string };
  slots: { when: string }[] = [];

  get identified(): boolean {
    return !!this.patient;
  }

  // A string render avoids needing the JSX runtime from a dist.
  override render(): string {
    return this.identified
      ? `Ofrece ${this.slots.length} horas y pregunta cuál prefiere.`
      : "Saluda y pide nombre y teléfono.";
  }
}
