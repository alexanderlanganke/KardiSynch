import React, { useState, useEffect } from 'react';
import { useAppContext } from './AppContext';

const PatientDashboard: React.FC = () => {
  const { setCurrentView, setCurrentPatientId } = useAppContext();
  const [patients, setPatients] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    name: '',
    dob: '',
    patientId: '',
    hospitalPatientId: '',
    hospitalVisitId: '',
    deviceManufacturer: '',
    lastSeenStartDate: '',
    lastSeenEndDate: '',
  });

  useEffect(() => {
    fetchPatients();
  }, [filters]);

  const fetchPatients = async () => {
    try {
      const fetchedPatients = await window.electronAPI.getAllPatients(filters);
      setPatients(fetchedPatients);
    } catch (error) {
      console.error('Error fetching patients:', error);
    }
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const selectPatient = (patientId: string) => {
    setCurrentView('patientDetail');
    setCurrentPatientId(patientId);
  };

  return (
    <main>
      <h1>Patient Dashboard</h1>

      <div className="filters">
        <input type="text" placeholder="Name" name="name" value={filters.name} onChange={handleFilterChange} />
        <input type="date" name="dob" value={filters.dob} onChange={handleFilterChange} />
        <input type="text" placeholder="Patient ID" name="patientId" value={filters.patientId} onChange={handleFilterChange} />
        <input type="text" placeholder="Hospital Patient ID" name="hospitalPatientId" value={filters.hospitalPatientId} onChange={handleFilterChange} />
        <input type="text" placeholder="Hospital Visit ID" name="hospitalVisitId" value={filters.hospitalVisitId} onChange={handleFilterChange} />
        <select name="deviceManufacturer" value={filters.deviceManufacturer} onChange={handleFilterChange}>
          <option value="">All Manufacturers</option>
          <option value="Medtronic">Medtronic</option>
          <option value="Abbott">Abbott</option>
          <option value="Boston Scientific">Boston Scientific</option>
          <option value="Biotronik">Biotronik</option>
        </select>
        <label>
          Last Seen Start Date:
          <input type="date" name="lastSeenStartDate" value={filters.lastSeenStartDate} onChange={handleFilterChange} />
        </label>
        <label>
          Last Seen End Date:
          <input type="date" name="lastSeenEndDate" value={filters.lastSeenEndDate} onChange={handleFilterChange} />
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
          {patients.map((patient) => (
            <tr key={patient.id} onClick={() => selectPatient(patient.id)}>
              <td>{patient.name}</td>
              <td>{patient.dob}</td>
              <td>{patient.hospitalPatientId}</td>
              <td>{patient.last_device_model}</td>
              <td>{patient.last_seen_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
};

export default PatientDashboard;
