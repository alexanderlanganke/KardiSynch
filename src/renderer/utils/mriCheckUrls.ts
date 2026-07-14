// Manufacturer MRI check URLs — links to each manufacturer's own MRI
// compatibility tool. Shared by PatientDashboard and PatientDetail so the
// two views can't drift apart.
const MRI_CHECK_URLS: Record<string, string> = {
  'medtronic': 'https://www.medtronic.com/en-us/healthcare-professionals/mri-resources/mr-conditional-search-tool.html',
  'biotronik': 'https://www.promricheck.com',
  'abbott': 'https://mri.merlin.net/',
  'st. jude': 'https://mri.merlin.net/',
  'sjm': 'https://mri.merlin.net/',
  'boston scientific': 'https://www.bostonscientific.com/imageready/en-US/model-lookup.html',
  'guidant': 'https://www.bostonscientific.com/en-US/medical-specialties/electrophysiology/mri-resources.html',
  'microport': 'https://www.crm.microport.com/automri/en/cardiologist/tool',
  'sorin': 'https://www.crm.microport.com/automri/en/cardiologist/tool',
};

export function getMriCheckUrl(manufacturer: string | undefined | null): string | null {
  const manu = (manufacturer || '').toLowerCase();
  if (!manu) return null;
  for (const [key, url] of Object.entries(MRI_CHECK_URLS)) {
    if (manu.includes(key)) return url;
  }
  return null;
}
