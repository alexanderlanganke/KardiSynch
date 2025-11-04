import { parseFile } from './parser';

// This module will be responsible for grouping files that belong to a single "Visit".
export const routeFiles = async (filename: string) => {
  console.log(`Routing file: ${filename}`);
  const data = await parseFile(filename);
  console.log('Parsed data:', data);
  // In the future, this is where we'll group files and save to the database.
};
