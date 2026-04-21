"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, Brain, ChevronDown, Mail, MapPin, Phone, Database, BarChart3 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface UseCasePageProps {
  title: string;
  description: string;
}

export default function UseCasePage({ title, description }: UseCasePageProps) {
  const [isContactOpen, setIsContactOpen] = useState(false);

  const navSections = [
    {
      title: "Industries",
      items: [
        "Retail",
        "QSR & Cloud Kitchens",
        "Supermarkets",
        "Delivery Partners",
        "BPO & Contact Centre",
        "Insurance & Banking",
        "Hospitality",
      ],
    },
    {
      title: "Features",
      items: [
        "Self-Learning",
        "Career Progression",
        "SOP/Audits",
        "Rewards & Recognition",
        "Ticketing",
      ],
    },
    {
      title: "Use Case",
      items: [
        "Onboarding",
        "Career Progression",
        "Mobile Learning",
        "Communication",
      ],
    },
    {
      title: "Company",
      items: ["About", "Contact"],
    },
  ];

  const useCaseRoutes: Record<string, string> = {
    "Onboarding": "/onboarding",
    "Career Progression": "/career-progression",
    "Mobile Learning": "/mobile-learning",
    "Communication": "/communication",
  };

  const brandGradientStyle = {
    background: "linear-gradient(135deg, #8B35EB 0%, #2960E8 100%)",
  } as const;

  return (
    <div className="relative min-h-[80vh] flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-[60] w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-8 lg:px-12 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-lg"
              style={brandGradientStyle}
            >
              <Brain size={20} />
            </div>
            <span className="text-2xl font-black text-primary tracking-tighter uppercase">LUCID</span>
          </Link>

          <div className="hidden lg:flex items-center gap-2">
            {navSections.map((section) => (
              <div key={section.title} className="relative group">
                <button className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-primary rounded-lg hover:bg-secondary transition-colors">
                  {section.title}
                  <ChevronDown className="h-3 w-3 transition-transform group-hover:rotate-180" />
                </button>
                <div className="absolute top-full left-0 pt-2 z-50 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                  <div className="bg-background border border-border rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] p-2 min-w-[220px]">
                    {section.items.map((item) => (
                      <Link
                        key={item}
                        href={section.title === "Use Case" ? useCaseRoutes[item] ?? "#" : "#"}
                        className="block px-4 py-3 text-sm font-medium text-foreground rounded-lg hover:bg-secondary transition-colors"
                      >
                        {item}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Button variant="ghost" asChild className="text-muted-foreground hover:text-primary">
              <Link href="/login">Log In</Link>
            </Button>
            <Button className="rounded-full px-5 text-white" style={brandGradientStyle} onClick={() => setIsContactOpen(true)}>
              Book Demo
            </Button>
          </div>
        </div>
      </nav>

      <div className="relative flex-1 flex flex-col items-center justify-center py-20 overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div
            className="absolute rounded-full bg-primary/40 blur-[180px] w-[80%] h-[80%] top-[-25%] left-[-15%] animate-pulse"
            style={{ animationDuration: "12s" }}
          />
          <div
            className="absolute rounded-full bg-primary/30 blur-[180px] w-[80%] h-[80%] bottom-[-25%] right-[-15%] animate-pulse"
            style={{ animationDuration: "15s" }}
          />
          <div className="absolute rounded-full bg-primary/20 blur-[150px] w-[60%] h-[60%] top-[10%] right-[5%]" />
        </div>

        {/* Floating decorative elements */}
        <div className="absolute left-10 top-20 hidden lg:flex items-center justify-center w-16 h-16 rounded-full bg-background border border-border animate-float-left">
          <BarChart3 className="h-7 w-7 text-foreground" />
        </div>
        <div className="absolute right-10 top-32 hidden lg:flex items-center justify-center w-16 h-16 rounded-full bg-background border border-border animate-float-right">
          <Database className="h-7 w-7 text-foreground" />
        </div>

        <motion.div
          className="relative z-10 text-center max-w-4xl mx-auto px-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-8 leading-tight">
            {title}
          </h1>
          <p className="text-xl text-muted-foreground mb-10 leading-relaxed max-w-3xl mx-auto">
            {description}
          </p>
          
          {/* Decorative card with gradient */}
          <div className="relative aspect-video rounded-3xl border border-border shadow-2xl bg-card p-12 overflow-hidden mb-12 max-w-2xl mx-auto">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/10" />
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-dashed border-primary/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 20, ease: "linear", repeat: Infinity }}
            />
            <div className="relative z-10 w-full h-full flex items-center justify-center">
              <div
                className="w-24 h-24 rounded-3xl shadow-2xl shadow-primary/40 flex items-center justify-center text-white"
                style={brandGradientStyle}
              >
                <Brain className="h-12 w-12" />
              </div>
            </div>
          </div>

          <Dialog open={isContactOpen} onOpenChange={setIsContactOpen}>
            <DialogTrigger asChild>
              <Button
                size="lg"
                className="rounded-full px-10 py-7 text-xl group text-white hover:opacity-90 transition-opacity"
                style={brandGradientStyle}
              >
                Get Started
                <ArrowRight className="ml-2 w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl p-0">
              <div className="grid md:grid-cols-2">
                <div className="p-8">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-bold">
                      Interested in Lucid?{" "}
                      <span className="text-primary">Send us a message</span>
                    </DialogTitle>
                    <DialogDescription>
                      Let&apos;s change how you and your teams work.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-6 space-y-4 text-sm text-muted-foreground">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Mail className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">Email</p>
                        <p>manish.chum@workfloww.ai</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Phone className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">Phone</p>
                        <p>+91 8527880288</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">Address</p>
                        <p>
                          ILD TRADE CENTER, 912-911, Badshahpur Sohna Rd, D1 Block,
                          Sector 47, Gurugram, Haryana 122018
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-8 bg-muted/30 border-l border-border">
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      alert("Thanks for reaching out! We’ll be in touch soon.");
                      setIsContactOpen(false);
                    }}
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="first-name">First name</Label>
                        <Input id="first-name" name="firstName" required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="last-name">Last name</Label>
                        <Input id="last-name" name="lastName" required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="work-email">Work email</Label>
                      <Input id="work-email" name="workEmail" type="email" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="organisation">Organisation</Label>
                      <Input id="organisation" name="organisation" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="message">Message</Label>
                      <Textarea id="message" name="message" rows={4} required />
                    </div>
                    <div className="flex items-start gap-3 text-sm text-muted-foreground">
                      <Checkbox id="consent" required />
                      {/* <Label htmlFor="consent" className="leading-snug">
                        I consent to the processing of my personal data in accordance with the privacy policy.
                      </Label> */}
                    </div>
                    <Button
                      type="submit"
                      className="rounded-full px-12 py-6 bg-primary hover:opacity-90"
                    >
                      Submit
                    </Button>
                  </form>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>
      </div>
    </div>
  );
}
