import React, { useState, useEffect } from 'react';
import { useAppContext } from './AppContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PatientDashboard: React.FC = () => {
  const { setCurrentView, setCurrentPatientId } = useAppContext();
  const [patients, setPatients] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    name: '',
    dob: '',
    hospitalPatientId: '',
    deviceManufacturer: '',
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

  const handleFilterChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleSelectChange = (name: string, value: string) => {
    setFilters({ ...filters, [name]: value === 'all' ? '' : value });
  };

  const selectPatient = (patientId: string) => {
    setCurrentView('patientDetail');
    setCurrentPatientId(patientId);
  };

  return (
    <div>
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Patient Dashboard
          </h2>
          <p className="text-muted-foreground">
            Here's a list of all patients.
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input
                type="text"
                placeholder="Name"
                name="name"
                value={filters.name}
                onChange={handleFilterChange}
              />
              <Input
                type="date"
                name="dob"
                value={filters.dob}
                onChange={handleFilterChange}
              />
              <Input
                type="text"
                placeholder="Hospital Patient ID"
                name="hospitalPatientId"
                value={filters.hospitalPatientId}
                onChange={handleFilterChange}
              />
              <Select
                name="deviceManufacturer"
                value={filters.deviceManufacturer || 'all'}
                onValueChange={(value) =>
                  handleSelectChange('deviceManufacturer', value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Manufacturers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Manufacturers</SelectItem>
                  <SelectItem value="Medtronic">Medtronic</SelectItem>
                  <SelectItem value="Abbott">Abbott</SelectItem>
                  <SelectItem value="Boston Scientific">
                    Boston Scientific
                  </SelectItem>
                  <SelectItem value="Biotronik">Biotronik</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Date of Birth</TableHead>
                  <TableHead>Hospital Patient ID</TableHead>
                  <TableHead>Last Device Model</TableHead>
                  <TableHead>Last Seen Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.map((patient) => (
                  <TableRow
                    key={patient.id}
                    onClick={() => selectPatient(patient.id)}
                    className="cursor-pointer"
                  >
                    <TableCell>{patient.name}</TableCell>
                    <TableCell>{patient.dob}</TableCell>
                    <TableCell>{patient.hospitalPatientId}</TableCell>
                    <TableCell>{patient.last_device_model}</TableCell>
                    <TableCell>{patient.last_seen_date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PatientDashboard;
