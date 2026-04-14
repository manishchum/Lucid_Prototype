"use client";

import React, { useEffect, useState } from 'react';
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  ChevronDown,
  ChevronRight,
  Database,
  Menu,
  Route,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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
      items: ["About","Contact"],
    },
  ];

  const useCaseRoutes: Record<string, string> = {
    "Onboarding": "/onboarding",
    "Career Progression": "/career-progression",
    "Mobile Learning": "/mobile-learning",
    "Communication": "/communication",
  };

  const features = [
    {
      title: "Living Knowledge Base",
      description: "Transform Raw Data Into Sales & Operations Intelligence",
      icon: Database,
    },
    {
      title: "Smart Intelligence",
      description: "Eliminates Redundancy through AI-driven insights",
      icon: Brain,
    },
    {
      title: "Adaptive Pathways",
      description: "Dynamic journeys based on performance & Performance Sprint",
      icon: Route,
    },
    {
      title: "Performance Coach",
      description: "Instant, contextual guidance in the flow of work",
      icon: Zap,
    },
    {
      title: "Competency Proofing",
      description: "Proof of action, not just knowledge",
      icon: ShieldCheck,
    },
  ];

  const brandGradientStyle = {
    background: "linear-gradient(135deg, #8B35EB 0%, #2960E8 100%)",
  } as const;

  const BookDemoDialog = ({ trigger }: { trigger: React.ReactNode }) => (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Book a Demo</DialogTitle>
          <DialogDescription>
            See how Lucid can accelerate your workforce outcomes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            alert("Demo request submitted! Our team will contact you shortly.");
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="demo-full-name">
              Full Name
            </label>
            <Input id="demo-full-name" name="fullName" required placeholder="Jane Doe" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="demo-work-email">
              Work Email
            </label>
            <Input
              id="demo-work-email"
              name="workEmail"
              type="email"
              required
              placeholder="jane@company.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="demo-company-name">
              Company Name
            </label>
            <Input id="demo-company-name" name="companyName" required placeholder="Company Inc." />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="demo-phone">
              Phone Number
            </label>
            <Input id="demo-phone" name="phone" type="tel" required placeholder="+1 (555) 000-1234" />
          </div>
          <Button type="submit" className="w-full">
            Submit
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    /* h-screen and overflow-hidden removes the scroller */
  <div className="min-h-screen w-full bg-background font-sans selection:bg-secondary flex flex-col relative">
      
      {/* Navbar */}
      <nav
        className={`sticky top-0 z-[60] w-full border-b transition-colors ${
          isScrolled
            ? "bg-background/80 border-border backdrop-blur-md"
            : "bg-transparent border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-8 lg:px-12 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-2xl flex items-center justify-center text-white shadow-lg"
              style={brandGradientStyle}
            >
              <Brain size={20} />
            </div>
            <span className="text-2xl font-black text-primary tracking-tighter uppercase">LUCID</span>
          </div>

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
            <BookDemoDialog
              trigger={
                <Button className="rounded-full px-5 text-white" style={brandGradientStyle}>
                  Book Demo
                </Button>
              }
            />
          </div>

          <div className="md:hidden">
            <button onClick={() => setIsMenuOpen(true)} className="text-foreground p-2">
              <Menu size={20} />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Content */}
      <section className="flex-1 overflow-hidden px-4 pt-32 pb-20 md:pt-48 md:pb-32 text-center relative">
        <div className="absolute -z-10 left-0 top-10 h-[40%] w-[40%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute -z-10 bottom-0 right-0 h-[40%] w-[40%] rounded-full bg-primary/10 blur-[120px]" />
        <div className="max-w-6xl mx-auto w-full">
          <div className="inline-flex items-center justify-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-primary mb-6">
            Enterprise Productivity Platform
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter leading-[0.9] text-foreground">
            Accelerate Your Workforce For{" "}
            <span
              className="italic font-serif"
              style={{ color: "oklch(0.52 0.28 290)" }}
            >
              Peak
            </span>{" "}Performance
          </h1>
          <p className="mt-6 mb-10 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Enterprise Productivity Platform Accelerating Sales & Operations Outcomes
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <BookDemoDialog
              trigger={
                <Button
                  size="lg"
                  className="group rounded-full px-8 py-6 text-lg text-white"
                  style={brandGradientStyle}
                >
                  Explore Lucid
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Button>
              }
            />
            <Button variant="outline" size="lg" className="group rounded-full px-8 py-6 text-lg">
              <Zap className="mr-2 h-5 w-5 text-primary transition-colors group-hover:fill-primary" />
              Watch Demo
            </Button>
          </div>

          <div className="mt-20 max-w-5xl mx-auto w-full h-[400px] md:h-[600px] relative flex items-center justify-center">
            <div className="absolute inset-0 bg-primary/10 blur-[120px] rounded-full" />
            <div className="absolute left-6 top-8 hidden lg:flex items-center justify-center w-16 h-16 rounded-full bg-background border border-border animate-float-left">
              <BarChart3 className="h-7 w-7 text-foreground" />
            </div>
            <div className="absolute right-6 top-12 hidden lg:flex items-center justify-center w-16 h-16 rounded-full bg-background border border-border animate-float-right">
              <Brain className="h-7 w-7 text-foreground" />
            </div>

                    <div className="relative z-10 w-full max-w-2xl bg-background/80 backdrop-blur-2xl border border-border rounded-[2.5rem] md:rounded-[3.5rem] p-8 md:p-16 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)] text-center">
                      <div className="flex items-center justify-center gap-3 mb-6">
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center text-white"
                          style={brandGradientStyle}
                        >
                          <Brain className="h-5 w-5" />
                        </div>
                        <h3 className="text-4xl md:text-6xl font-bold tracking-tighter text-primary">lucid</h3>
                      </div>
              <p className="text-lg md:text-2xl text-muted-foreground font-medium mb-10 md:mb-16">
                One Platform for Peak Performance
              </p>
              <div className="relative flex items-center justify-between px-2 md:px-4">
                <div className="absolute left-0 right-0 top-1/2 -z-10 border-t-2 border-dashed border-muted-foreground/20" />
                {[
                  { label: "Knowledge", icon: Database },
                  { label: "Intelligence", icon: Brain },
                  { label: "Pathways", icon: Route },
                  { label: "Coaching", icon: Zap },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-3">
                    <div className="w-12 md:w-20 h-12 md:h-20 rounded-full bg-foreground text-background flex items-center justify-center ring-4 ring-background shadow-2xl">
                      <item.icon className="h-5 w-5 md:h-8 md:w-8" />
                    </div>
                    <span className="font-bold text-[10px] md:text-xs uppercase tracking-widest text-muted-foreground">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </section>

      <section id="features" className="py-24 bg-secondary/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            Built for the Modern Workforce
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Everything teams need to keep knowledge current, performance visible, and people growing.
          </p>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-left">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="group rounded-2xl bg-background border border-transparent shadow-sm hover:shadow-xl transition-all duration-300 p-6"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-bold">{feature.title}</h3>
                <p className="mt-2 text-muted-foreground">{feature.description}</p>
                <Button variant="link" className="px-0 mt-4 text-primary" asChild>
                  {/* <a href="#">
                    Learn more
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </a> */}
                </Button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider px-3 py-1 mb-6">
              <Database className="h-4 w-4" />
              Living Knowledge Base
            </div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">
              Transform Raw Data Into{" "}
              <span className="text-primary">Actionable Intelligence</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Unify operational knowledge, performance insights, and frontline execution into a single living system that evolves in real time.
            </p>
            <div className="grid gap-4 mb-8">
              {[
                "Real-time data processing",
                "AI-driven redundancy elimination",
                "Contextual guidance in the flow of work",
                "Proof of action verification",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm md:text-base text-foreground">
                  <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                    <ShieldCheck className="h-3 w-3 text-primary" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
            <BookDemoDialog
              trigger={
                <Button size="lg" className="rounded-full px-8 text-white" style={brandGradientStyle}>
                  Book Demo
                </Button>
              }
            />
          </div>
          <div className="relative aspect-square rounded-3xl border border-border shadow-2xl bg-card p-12 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/10" />
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-dashed border-primary/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 20, ease: "linear", repeat: Infinity }}
            />
            <div className="relative z-10 w-full h-full flex items-center justify-center">
              <div
                className="w-32 h-32 rounded-3xl shadow-2xl shadow-primary/40 flex items-center justify-center text-white"
                style={brandGradientStyle}
              >
                <Brain className="h-16 w-16" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="container mx-auto px-6">
          <div className="bg-primary rounded-[3rem] p-12 md:p-20 text-center relative overflow-hidden">
            <h2 className="text-4xl md:text-6xl font-bold text-black tracking-tight mb-8">
              Ready to <span
              className="italic font-serif"
              style={{ color: "oklch(0.52 0.28 290)" }}
            >
              Accelerate
            </span> Your Workforce?
            </h2>
            <p className="text-primary-foreground/80 text-xl mb-10">
              Build a smarter, faster, and more adaptive organization with Lucid.
            </p>
            <BookDemoDialog
              trigger={
                <Button
                  size="lg"
                  className="rounded-full px-12 py-8 text-xl font-bold transition-transform hover:scale-105 text-white"
                  style={brandGradientStyle}
                >
                  Book Demo
                </Button>
              }
            />
          </div>
        </div>
      </section>

      <footer className="bg-background border-t border-border py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8">
          <Link
            href="/"
            className="text-4xl font-black tracking-tighter mb-12 block text-primary"
          >
            LUCID
          </Link>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
            <div>
              <h4 className="font-bold text-lg mb-8">Industries</h4>
              <ul className="space-y-3">
                {[
                  "Retail",
                  "QSR & Cloud Kitchens",
                  "Supermarkets",
                  "Delivery Partners",
                ].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-8">Features</h4>
              <ul className="space-y-3">
                {[
                  "Self-Learning",
                  "Career Progression",
                  "SOP/Audits",
                  "Rewards & Recognition",
                ].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-8">Use Case</h4>
              <ul className="space-y-3">
                {Object.entries(useCaseRoutes).map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="text-muted-foreground hover:text-primary transition-colors">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-8">Company</h4>
              <ul className="space-y-3">
                {[
                  { label: "About", href: "#" },
                  // { label: "Certifications", href: "#" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.href} className="text-muted-foreground hover:text-primary transition-colors">
                      {item.label}
                    </a>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setIsContactModalOpen(true)}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    Contact
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 mt-12 border-t border-border flex flex-col md:flex-row justify-between gap-4 text-sm text-muted-foreground">
            <span>© {new Date().getFullYear()} Lucid. All rights reserved.</span>
            <div className="flex gap-6">
              <Link href="/terms" className="hover:text-primary transition-colors">
                Terms of Service
              </Link>
              <Link href="/privacy-policy" className="hover:text-primary transition-colors">
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>

      <Dialog open={isContactModalOpen} onOpenChange={setIsContactModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Contact Us</DialogTitle>
            <DialogDescription>
              Share your details and we’ll reach out shortly.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              alert("Thanks for reaching out! We’ll be in touch soon.");
              setIsContactModalOpen(false);
            }}
          >
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="contact-name">
                Full Name
              </label>
              <Input id="contact-name" name="contactName" required placeholder="Jane Doe" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="contact-email">
                Work Email
              </label>
              <Input id="contact-email" name="contactEmail" type="email" required placeholder="jane@company.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="contact-company">
                Company Name
              </label>
              <Input id="contact-company" name="contactCompany" required placeholder="Company Inc." />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="contact-message">
                Message
              </label>
              <Input id="contact-message" name="contactMessage" required placeholder="How can we help?" />
            </div>
            <Button type="submit" className="w-full">
              Submit
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
  <div className="fixed inset-0 bg-background z-[100] flex flex-col p-4 md:hidden">
          <div className="flex justify-between items-center mb-8 md:mb-12">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-2xl flex items-center justify-center text-white"
                style={brandGradientStyle}
              >
                <Brain size={18} />
              </div>
              <span className="text-lg font-black text-primary tracking-tighter">Lucid</span>
            </div>
            <button onClick={() => setIsMenuOpen(false)} className="text-muted-foreground p-2">
              <X size={24} />
            </button>
          </div>
          <nav className="flex flex-col items-center justify-center flex-1 gap-6 -mt-10">
            <a href="#features" className="text-lg font-black text-foreground">Features</a>
            <a href="#pricing" className="text-lg font-black text-foreground">Pricing</a>
            <Link href="/login" className="text-lg font-black text-foreground">Log In</Link>
            <Link href="/signup" className="w-full max-w-xs">
              <button className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-full font-black text-base shadow-lg">Sign up</button>
            </Link>
          </nav>
        </div>
      )}

    </div>
  );
}
