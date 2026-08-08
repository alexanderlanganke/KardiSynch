import React, { useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { buildFuQrPayload, hasClinicalData } from '@/renderer/utils/visitToFuPayload';
import { QrCode } from 'lucide-react';

interface QrCodeViewProps {
  report: any;
  patient?: any;
}

const QrCodeView: React.FC<QrCodeViewProps> = ({ report, patient }) => {
  const payload = useMemo(() => buildFuQrPayload(report, patient), [report, patient]);

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (patient?.first_name || patient?.last_name) {
      parts.push([patient.first_name, patient.last_name].filter(Boolean).join(' '));
    }
    if (report?.interrogation_date) parts.push(report.interrogation_date);
    if (report?.deviceModel) parts.push(report.deviceModel);
    if (report?.batteryVoltage && report?.batteryStatus) {
      parts.push(`${report.batteryVoltage}V ${report.batteryStatus}`);
    } else if (report?.batteryStatus) {
      parts.push(report.batteryStatus);
    }
    return parts.join(' · ');
  }, [report, patient]);

  if (!report || !hasClinicalData(report)) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground py-10">
        <QrCode className="h-12 w-12 mb-4 opacity-10" />
        <div className="text-sm">No clinical data available for QR export</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-2">
      <div className="bg-white p-4 rounded-lg shadow-sm">
        <QRCodeSVG
          value={payload}
          size={280}
          level="M"
          bgColor="#ffffff"
          fgColor="#000000"
        />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">
          Scan with CardioPal to import data
        </p>
        {summary && (
          <p className="text-xs text-muted-foreground/70">{summary}</p>
        )}
      </div>
    </div>
  );
};

export default QrCodeView;
