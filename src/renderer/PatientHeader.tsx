
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { UnifiedReport } from '../main/reports';

interface PatientHeaderProps {
  report: UnifiedReport;
}

const PatientHeader: React.FC<PatientHeaderProps> = ({ report }) => {
  const { patient, device } = report;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Patient Information</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold">Patient</h3>
          <p>Name: {`${patient.first_name} ${patient.last_name}`}</p>
          <p>DOB: {patient.dob}</p>
        </div>
        <div>
          <h3 className="font-semibold">Device</h3>
          <p>Model: {device.model}</p>
          <p>Serial: {device.serial_number}</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default PatientHeader;
