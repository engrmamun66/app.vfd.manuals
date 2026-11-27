/** Sidebar structure, shared by the app shell and the Super Admin "Premium settings" page (which lists the menus that can be locked). */
export interface NavSection { title?: string; items: [string, string, boolean?][] }

export function mainSections(taxonomy: any[] | null | undefined): NavSection[] {
  const kbCats = (taxonomy ?? []).filter((c: any) => c.show_nav);
  return [
    { items: [['/', 'Dashboard']] },
    { title: 'Knowledge Base', items: [['/parameters', 'All Parameters'], ...kbCats.map((c: any): [string, string, boolean] => [`/kb/${c.slug}`, c.name, true]), ['/knowledge', 'My categories']] },
    { title: 'Diagnostics', items: [['/knowledge/fault', 'Faults'], ['/knowledge/alarm', 'Alarms'], ['/knowledge/warning', 'Warnings'], ['/knowledge/troubleshooting', 'Troubleshooting']] },
    { title: 'Installation & Wiring', items: [['/knowledge/wiring', 'Wiring & Terminals'], ['/knowledge/installation', 'Installation'], ['/knowledge/safety', 'Safety']] },
    { title: 'Technical Reference', items: [['/knowledge/specification', 'Specifications'], ['/knowledge/communication', 'Communication'], ['/knowledge/maintenance', 'Maintenance'], ['/knowledge/note', 'Notes']] },
    { title: 'Modbus & RS485', items: [['/modbus/registers', 'Register Explorer'], ['/modbus/communication', 'Communication Settings'], ['/modbus/converter', 'Address Converter']] },
    { title: 'Research', items: [['/compare', 'Multi-Brand Comparison'], ['/bookmarks', 'Research Bookmarks'], ['/annotations', 'My Annotations']] },
    { title: 'Documentation Library', items: [['/library', 'Manuals']] },
  ];
}

export const ADMIN_HOME = '/superadmin';
export const isAdminPath = (p: string) => p === ADMIN_HOME || p.startsWith(ADMIN_HOME + '/');

/** Everything that belongs to the Super Admin lives under /superadmin. */
export const adminSections: NavSection[] = [
  { title: 'Premium', items: [['/superadmin/pricing', 'Pricing'], ['/superadmin/subscriptions', 'Subscriptions'], ['/superadmin/payments', 'Payments'], ['/superadmin/premium', 'Premium Settings']] },
  { title: 'Content', items: [['/superadmin/verification', 'Verification Center'], ['/superadmin/content', 'Content & Order']] },
  { title: 'Users', items: [['/superadmin/users', 'Users & Monitoring'], ['/superadmin/requests', 'User Requests'], ['/superadmin/logs', 'Activity & Audit']] },
];
