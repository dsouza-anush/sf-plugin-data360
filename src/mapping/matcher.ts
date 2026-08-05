// Adapted from Jaganpro/sf-cli-plugin-data360 (MIT).
const synonyms: Readonly<Record<string, readonly string[]>> = {
  email: ['emailaddress'],
  phone: ['phonenumber', 'formattede164phone', 'telephonenumber'],
  name: ['personname'],
  id: ['externalrecordid', 'individualid', 'contactpointemailid', 'partyid'],
  accountid: ['primaryaccountid', 'account'],
  mailingstreet: ['addressline1'],
  mailingcity: ['cityname'],
  mailingstate: ['stateprovincename'],
  mailingpostalcode: ['postalcodeid'],
  mailingcountry: ['countryname'],
};

export type Field = { name: string };
export type FieldMatch = {
  sourceFieldDeveloperName: string;
  targetFieldDeveloperName: string;
  matchType: 'exact' | 'synonym' | 'prefix';
};
export type MatchResult = { mappings: FieldMatch[]; unmapped: string[]; ambiguous: string[] };

const base = (name: string): string =>
  name
    .replace(/^ssot__/u, '')
    .replace(/^KQ_/u, '')
    .replace(/_c__c$/u, '')
    .replace(/__c$/u, '')
    .replace(/_c$/u, '')
    .toLowerCase();

export const matchFields = (sources: readonly Field[], targets: readonly Field[]): MatchResult => {
  const orderedTargets = [...targets].sort((left, right) => left.name.localeCompare(right.name));
  const mappings: FieldMatch[] = [];
  const unmapped: string[] = [];
  const ambiguous: string[] = [];
  for (const source of sources) {
    const sourceBase = base(source.name);
    const literal = orderedTargets.filter((target) => target.name.toLowerCase() === source.name.toLowerCase());
    const normalizedExact = orderedTargets.filter((target) => base(target.name) === sourceBase);
    const synonym = orderedTargets.filter((target) => (synonyms[sourceBase] ?? []).includes(base(target.name)));
    const prefix = orderedTargets.filter((target) => {
      const targetBase = base(target.name);
      return (
        sourceBase.length >= 5 &&
        targetBase.length >= 5 &&
        (sourceBase.startsWith(targetBase) || targetBase.startsWith(sourceBase))
      );
    });
    const candidates: Array<{ values: Field[]; type: FieldMatch['matchType'] }> = [
      { values: literal, type: 'exact' },
      { values: normalizedExact, type: 'exact' },
      { values: synonym, type: 'synonym' },
      { values: prefix, type: 'prefix' },
    ];
    const selected = candidates.find(({ values }) => values.length > 0);
    if (!selected) {
      unmapped.push(source.name);
    } else if (selected.values.length > 1) {
      ambiguous.push(source.name);
    } else {
      mappings.push({
        sourceFieldDeveloperName: source.name,
        targetFieldDeveloperName: selected.values[0].name,
        matchType: selected.type,
      });
    }
  }
  return { mappings, unmapped, ambiguous };
};
