import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Filter, User, Calendar, Clock, MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Patient {
  id: number;
  patientId: string;
  name: string;
  dob: string;
  lastReportDate: string;
  reportCount: number;
}

const PatientDashboard: React.FC = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const data = await window.electronAPI.getAllPatients({});
        setPatients(data);
      } catch (error) {
        console.error('Error fetching patients:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPatients();
  }, []);

  const filteredPatients = patients.filter(p =>
    (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.patientId || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Patients
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Manage patient records and view interrogation reports.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full md:w-96 group">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            <Input
              placeholder="Search by name or ID..."
              className="pl-10 h-11 bg-background/50 backdrop-blur-sm border-muted-foreground/20 focus:border-primary/50 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" className="h-11 w-11 rounded-xl border-muted-foreground/20 hover:bg-muted/50">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Overview (Placeholder for now) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card border-none bg-gradient-to-br from-blue-500/10 to-purple-500/10">
          <CardHeader className="pb-2">
            <CardDescription>Total Patients</CardDescription>
            <CardTitle className="text-4xl">{patients.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">+2 from yesterday</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-none bg-gradient-to-br from-emerald-500/10 to-teal-500/10">
          <CardHeader className="pb-2">
            <CardDescription>Reports Processed</CardDescription>
            <CardTitle className="text-4xl">{patients.reduce((acc, p) => acc + p.reportCount, 0)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">+12 this week</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-none bg-gradient-to-br from-orange-500/10 to-red-500/10">
          <CardHeader className="pb-2">
            <CardDescription>Pending Review</CardDescription>
            <CardTitle className="text-4xl">5</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">Requires attention</div>
          </CardContent>
        </Card>
      </div>

      {/* Patient Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-20 text-muted-foreground">Loading patients...</div>
        ) : filteredPatients.length === 0 ? (
          <div className="col-span-full text-center py-20 text-muted-foreground">No patients found.</div>
        ) : (
          filteredPatients.map((patient) => (
            <Card key={patient.id} className="glass-card group cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5 border-muted-foreground/10">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold leading-none flex items-center gap-2">
                    {patient.name}
                  </CardTitle>
                  <CardDescription className="text-xs font-mono opacity-70">
                    {patient.patientId}
                  </CardDescription>
                </div>
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <User className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 mt-2">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Calendar className="mr-2 h-3 w-3" />
                    <span className="text-xs">DOB: {patient.dob}</span>
                  </div>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Clock className="mr-2 h-3 w-3" />
                    <span className="text-xs">Last: {patient.lastReportDate || 'Never'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge variant="secondary" className="bg-secondary/50 hover:bg-secondary/70 transition-colors">
                      {patient.reportCount} Reports
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default PatientDashboard;
