"use client";

import React, { useState, useTransition } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequestCard } from "@/components/requests/request-card";
import { FormattedBloodRequest } from "@/lib/supabase/types";
import { filterBloodRequestsAction } from "@/lib/requests/actions";
import {
  Search,
  Filter,
  RefreshCw,
  Droplet,
  SlidersHorizontal,
  Loader2,
} from "lucide-react";

interface RequestDirectoryClientProps {
  initialRequests: FormattedBloodRequest[];
  isStaffOrAdmin?: boolean;
}

export function RequestDirectoryClient({
  initialRequests,
}: RequestDirectoryClientProps) {
  const [requests, setRequests] = useState<FormattedBloodRequest[]>(initialRequests);
  const [query, setQuery] = useState("");
  const [bloodGroup, setBloodGroup] = useState("ALL");
  const [component, setComponent] = useState("ALL");
  const [urgency, setUrgency] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [hospital, setHospital] = useState("");
  const [isLoading, startTransition] = useTransition();

  const handleFilter = () => {
    startTransition(async () => {
      const res = await filterBloodRequestsAction({
        query: query || undefined,
        bloodGroup: bloodGroup !== "ALL" ? bloodGroup : undefined,
        component: component !== "ALL" ? component : undefined,
        urgency: urgency !== "ALL" ? urgency : undefined,
        status: status !== "ALL" ? status : undefined,
        hospital: hospital || undefined,
      });

      if (res.success && res.data) {
        setRequests(res.data);
      }
    });
  };

  const handleReset = () => {
    setQuery("");
    setBloodGroup("ALL");
    setComponent("ALL");
    setUrgency("ALL");
    setStatus("ALL");
    setHospital("");
    startTransition(async () => {
      const res = await filterBloodRequestsAction({});
      if (res.success && res.data) {
        setRequests(res.data);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters Toolbar Card */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" />
              Requisition Search & Multi-Parameter Filters
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {requests.length} requisition(s) found
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            {/* Search Query */}
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">
                Search Hospital / City / Patient
              </label>
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-3 text-muted-foreground" />
                <Input
                  placeholder="e.g. General Hospital, Manila"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 text-xs"
                />
              </div>
            </div>

            {/* Blood Group */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Blood Group
              </label>
              <Select value={bloodGroup} onValueChange={(val) => setBloodGroup(val || "ALL")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Groups</SelectItem>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A-">A-</SelectItem>
                  <SelectItem value="B+">B+</SelectItem>
                  <SelectItem value="B-">B-</SelectItem>
                  <SelectItem value="AB+">AB+</SelectItem>
                  <SelectItem value="AB-">AB-</SelectItem>
                  <SelectItem value="O+">O+</SelectItem>
                  <SelectItem value="O-">O-</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Component */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Component
              </label>
              <Select value={component} onValueChange={(val) => setComponent(val || "ALL")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="All Components" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Components</SelectItem>
                  <SelectItem value="WHOLE_BLOOD">Whole Blood</SelectItem>
                  <SelectItem value="PRBC">Packed Red Cells</SelectItem>
                  <SelectItem value="PLATELETS">Platelets</SelectItem>
                  <SelectItem value="FFP">Fresh Frozen Plasma</SelectItem>
                  <SelectItem value="CRYOPRECIPITATE">Cryoprecipitate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Urgency */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Urgency Tier
              </label>
              <Select value={urgency} onValueChange={(val) => setUrgency(val || "ALL")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="All Tiers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Urgencies</SelectItem>
                  <SelectItem value="ROUTINE">Routine</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                  <SelectItem value="CRITICAL_STAT">Critical STAT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Requisition Status
              </label>
              <Select value={status} onValueChange={(val) => setStatus(val || "ALL")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="OPEN">Open (Active / Review)</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress (Committed)</SelectItem>
                  <SelectItem value="FULFILLED">Fulfilled</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={isLoading}
              className="text-xs gap-1"
            >
              <RefreshCw className="size-3" />
              Reset Filters
            </Button>
            <Button
              size="sm"
              onClick={handleFilter}
              disabled={isLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs gap-1.5 font-semibold"
            >
              {isLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Filter className="size-3" />
              )}
              Filter Requisitions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Requisitions List Display */}
      {requests.length === 0 ? (
        <Card className="border-dashed border-border/80">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-3">
            <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Droplet className="size-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">No Requisitions Found</h3>
              <p className="text-xs text-muted-foreground max-w-sm">
                No blood requests matched your search or filter parameters. Try expanding your search or resetting the filters.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset} className="text-xs">
              Clear Filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </div>
  );
}
