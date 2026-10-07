import { CATALOG, PROGRAM_KIND_LABELS, PROGRAM_KIND_ORDER } from "../rewards";

/**
 * The built-in catalog as `<option>`s, grouped by kind — card points, airline
 * miles, hotel points — which is how a household thinks of what they hold. One
 * component because both rewards forms ask the same question.
 */
export default function ProgramOptions() {
  return PROGRAM_KIND_ORDER.map((kind) => (
    <optgroup key={kind} label={PROGRAM_KIND_LABELS[kind]}>
      {CATALOG.filter((program) => program.kind === kind).map((program) => (
        <option key={program.id} value={program.id}>
          {program.name}
        </option>
      ))}
    </optgroup>
  ));
}
