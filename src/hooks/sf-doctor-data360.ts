import type { SfDoctor } from '@salesforce/plugin-info';

const pluginName = '@anushdsouza/sf-plugin-data360';
const genericChecks = [
  {
    name: 'Org authentication',
    detail: 'Not evaluated because generic sf doctor does not resolve a target org.',
  },
  {
    name: 'API version alignment',
    detail: 'Not evaluated because generic sf doctor has no target-org API version.',
  },
  {
    name: 'Data 360 provisioning',
    detail: 'Not evaluated because generic sf doctor does not perform org network calls.',
  },
  {
    name: 'Data spaces',
    detail: 'Not evaluated because generic sf doctor does not perform org network calls.',
  },
] as const;

export const hook = async ({ doctor }: { doctor: SfDoctor }): Promise<void> => {
  for (const check of genericChecks) {
    doctor.addPluginData(pluginName, { check: check.name, status: 'warn', detail: check.detail });
    doctor.addDiagnosticStatus({ testName: `Data 360: ${check.name}`, status: 'warn' });
  }
  doctor.addSuggestion('Run sf data360 doctor -o <target-org> for org-specific Data 360 diagnostics.');
};
