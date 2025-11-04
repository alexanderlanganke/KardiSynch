import { writable } from 'svelte/store';

export const currentView = writable('dashboard');
export const currentPatientId = writable(null);

export interface ViewerSlot {
  report: any;
  viewMode: 'pdf' | 'data';
}

// Each slot can hold a ViewerSlot object or be null.
export const viewerSlots = writable<(ViewerSlot | null)[]>([null, null, null]);
