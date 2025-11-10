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
import { Label } from '@/components/ui/label';

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
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Patient Dashboard</h1>

      <Card className="mb-6">
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
              placeholder="Patient ID"
              name="patientId"
              value={filters.patientId}
              onChange={handleFilterChange}
            />
            <Input
              type="text"
              placeholder="Hospital Patient ID"
              name="hospitalPatientId"
              value={filters.hospitalPatientId}
              onChange={handleFilterChange}
            />
            <Input
              type="text"
              placeholder="Hospital Visit ID"
              name="hospitalVisitId"
              value={filters.hospitalVisitId}
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
            <div className="flex flex-col">
              <Label htmlFor="lastSeenStartDate" className="mb-2">
                Last Seen Start Date:
              </Label>
              <Input
                id="lastSeenStartDate"
                type="date"
                name="lastSeenStartDate"
                value={filters.lastSeenStartDate}
                onChange={handleFilterChange}
              />
            </div>
            <div className="flex flex-col">
              <Label htmlFor="lastSeenEndDate" className="mb-2">
                Last Seen End Date:
              </Label>
              <Input
                id="lastSeenEndDate"
                type="date"
                name="lastSeenEndDate"
                value={filters.lastSeenEndDate}
                onChange={handleFilterChange}
              />
            </div>
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
  );
};

export default PatientDashboard;
