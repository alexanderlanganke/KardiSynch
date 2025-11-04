import { writable } from 'svelte/store';

export const currentView = writable('dashboard');
export const currentPatientId = writable(null);
