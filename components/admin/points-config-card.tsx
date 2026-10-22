"use client";

import React, { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Award, CheckCircle2, AlertTriangle, Loader2, Save } from "lucide-react";
import { updatePointsConfigAction } from "@/lib/reports/actions";

export interface PointsConfigItem {
  key: string;
  value: number;
  description?: string;
}

interface PointsConfigCardProps {
  initialConfig: PointsConfigItem[];
}

export function PointsConfigCard({ initialConfig }: PointsConfigCardProps) {
  const [config, setConfig] = useState<PointsConfigItem[]>(initialConfig);
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleValueChange = (key: string, newVal: number) => {
    setConfig((prev) =>
      prev.map((item) => (item.key === key ? { ...item, value: newVal } : item))
    );
  };

  const handleSave = (item: PointsConfigItem) => {
    setStatusMessage(null);
    startTransition(async () => {
      try {
        const res = await updatePointsConfigAction({
          key: item.key,
          value: item.value,
        });

        if (res.success) {
          setStatusMessage({
            type: "success",
            text: `Successfully updated '${item.key}' to ${item.value} points.`,
          });
        } else {
          setStatusMessage({
            type: "error",
            text: res.error || "Failed to update points configuration.",
          });
        }
      } catch (err: unknown) {
        setStatusMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Error saving points configuration.",
        });
      }
    });
  };

  return (
    <Card className="border-border/60 shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="size-5 text-purple-600 dark:text-purple-400" />
            <CardTitle className="text-lg">Points Policy & Recognition Thresholds</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30">
            Platform Policy
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Configure default non-monetary recognition points awarded per verified blood donation and thresholds for donor recognition tiers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusMessage && (
          <Alert variant={statusMessage.type === "success" ? "default" : "destructive"} className="py-2.5">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="size-4" />
            )}
            <AlertTitle className="text-xs font-semibold">
              {statusMessage.type === "success" ? "Points Policy Updated" : "Update Failed"}
            </AlertTitle>
            <AlertDescription className="text-xs">{statusMessage.text}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {config.map((item) => (
            <div
              key={item.key}
              className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-2 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`input-${item.key}`} className="text-xs font-semibold capitalize">
                    {item.key.replace(/_/g, " ")}
                  </Label>
                  <span className="text-[11px] font-mono text-muted-foreground">{item.value} pts</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{item.description}</p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Input
                  id={`input-${item.key}`}
                  type="number"
                  min="1"
                  max="5000"
                  value={item.value}
                  onChange={(e) => handleValueChange(item.key, parseInt(e.target.value, 10) || 0)}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSave(item)}
                  disabled={isPending}
                  className="h-8 text-xs font-semibold shrink-0 gap-1 border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
                >
                  {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                  Save
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-0 text-[11px] text-muted-foreground">
        Points are non-monetary and solely reflect voluntary donor appreciation and engagement honors.
      </CardFooter>
    </Card>
  );
}
