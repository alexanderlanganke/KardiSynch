<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView, currentPatientId } from './stores';

  let patients = [];
  let filters = {
    name: '',
    dob: '',
    patientId: '',
    hospitalPatientId: '',
    hospitalVisitId: '',
    deviceManufacturer: '',
    lastSeenStartDate: '',
    lastSeenEndDate: '',
  };

  onMount(async () => {
    await fetchPatients();
  });

  async function fetchPatients() {
    try {
      patients = await window.electronAPI.getAllPatients(filters);
    } catch (error) {
      console.error('Error fetching patients:', error);
    }
  }

  function handleFilterChange() {
    fetchPatients();
  }

  function selectPatient(patientId) {
    currentView.set('patientDetail');
    currentPatientId.set(patientId);
  }
</script>

<main>
  <h1>Patient Dashboard</h1>

  <div class="filters">
    <input type="text" placeholder="Name" bind:value={filters.name} on:input={handleFilterChange} />
    <input type="date" bind:value={filters.dob} on:change={handleFilterChange} />
    <input type="text" placeholder="Patient ID" bind:value={filters.patientId} on:input={handleFilterChange} />
    <input type="text" placeholder="Hospital Patient ID" bind:value={filters.hospitalPatientId} on:input={handleFilterChange} />
    <input type="text" placeholder="Hospital Visit ID" bind:value={filters.hospitalVisitId} on:input={handleFilterChange} />
    <select bind:value={filters.deviceManufacturer} on:change={handleFilterChange}>
      <option value="">All Manufacturers</option>
      <option value="Medtronic">Medtronic</option>
      <option value="Abbott">Abbott</option>
      <option value="Boston Scientific">Boston Scientific</option>
      <option value="Biotronik">Biotronik</option>
    </select>
    <label>
      Last Seen Start Date:
      <input type="date" bind:value={filters.lastSeenStartDate} on:change={handleFilterChange} />
    </label>
    <label>
      Last Seen End Date:
      <input type="date" bind:value={filters.lastSeenEndDate} on:change={handleFilterChange} />
    </label>
  </div>

  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Date of Birth</th>
        <th>Hospital Patient ID</th>
        <th>Last Device Model</th>
        <th>Last Seen Date</th>
      </tr>
    </thead>
    <tbody>
      {#each patients as patient}
        <tr on:click={() => selectPatient(patient.id)}>
          <td>{patient.name}</td>
          <td>{patient.dob}</td>
          <td>{patient.hospitalPatientId}</td>
          <td>{patient.last_device_model}</td>
          <td>{patient.last_seen_date}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</main>

<style>
  main {
    padding: 1em;
  }
  .filters {
    display: flex;
    gap: 1em;
    margin-bottom: 1em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 8px;
  }
  th {
    background-color: #f2f2f2;
  }
</style>
