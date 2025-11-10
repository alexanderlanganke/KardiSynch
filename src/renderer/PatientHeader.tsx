
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { UnifiedReport } from '../main/reports';

interface PatientHeaderProps {
  report: UnifiedReport;
}

const PatientHeader: React.FC<PatientHeaderProps> = ({ report }) => {
  const { patient, device } = report;
  return (
    <Card className="mb-2 p-2">
      <CardContent className="flex items-center justify-between p-0">
        <div className="flex space-x-4">
          <div>
            <h3 className="font-semibold text-sm">Patient</h3>
            <p className="text-xs">
              {`${patient.first_name} ${patient.last_name}`} ({patient.dob})
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-sm">Device</h3>
            <p className="text-xs">
              {device.model} (SN: {device.serial_number})
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PatientHeader;
