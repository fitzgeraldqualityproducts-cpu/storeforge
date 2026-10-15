"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2Icon,
  LinkIcon,
  Loader2Icon,
  SaveIcon,
  ShieldCheckIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  InputFormValues,
  TONES,
  fromProjectInputs,
  submitIssues,
  toProjectInputs,
} from "@/lib/forms/input-form";
import { usePatchProject, useStartJob, useWizard } from "../context";
import { Dropzone } from "../dropzone";
import { Field, fieldAria } from "../field";
import { StepShell } from "../step-shell";

export function InputStep() {
  const { view } = useWizard();
  const project = view.project;
  const patch = usePatchProject({ silent: true });
  const start = useStartJob();
  const imageCount = view.assets.filter((a) => !a.discarded).length;

  const form = useForm<InputFormValues>({
    resolver: zodResolver(InputFormValues),
    defaultValues: fromProjectInputs(project.inputs, project.rightsAck.accepted),
    mode: "onBlur",
  });
  const { register, control, formState, handleSubmit, setError, getValues } = form;
  const errors = formState.errors;
  const values = useWatch({ control });

  // Autosave: debounce changes, save only values that pass field validation.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      const parsed = InputFormValues.safeParse(getValues());
      if (!parsed.success) return;
      patch.mutate({
        inputs: toProjectInputs(parsed.data),
        rightsAccepted: parsed.data.rightsAccepted,
      });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values)]);

  const save = async (v: InputFormValues, generate: boolean) => {
    if (generate) {
      const issues = submitIssues(v, imageCount);
      if (issues.length) {
        issues.forEach((i) => setError(i.path as never, { message: i.message }));
        toast.error(issues[0]!.message);
        return;
      }
    }
    await patch.mutateAsync({ inputs: toProjectInputs(v), rightsAccepted: v.rightsAccepted });
    if (generate) {
      await start.mutateAsync({ path: "pipeline" });
      toast.success("Generating your store", {
        description: "Live progress appears in the sidebar.",
      });
    } else {
      toast.success("Saved");
    }
  };

  const ackAt = project.rightsAck.at ? new Date(project.rightsAck.at).toLocaleString() : null;

  return (
    <StepShell
      step="input"
      description="Give us a product link, photos, or both. Context is optional but makes everything downstream sharper."
    >
      <form
        noValidate
        className="grid gap-6"
        onSubmit={handleSubmit((v) => save(v, true))}
        aria-describedby="input-step-help"
      >
        <p id="input-step-help" className="sr-only">
          At least one product URL or one image is required, plus the rights confirmation.
        </p>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="size-4 text-ember" /> Product links
            </CardTitle>
            <CardDescription>
              Up to 3: your source product page plus competitor or reference pages. Supplier sites,
              marketplaces and brand sites all work.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {[0, 1, 2].map((i) => {
              const err = errors.urls?.[i]?.value?.message;
              return (
                <Field
                  key={i}
                  id={`url-${i}`}
                  label={i === 0 ? "Primary product URL" : `Reference URL ${i}`}
                  optional={i > 0}
                  error={err}
                >
                  <Input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder={i === 0 ? "https://supplier.example.com/products/…" : "https://"}
                    {...fieldAria(`url-${i}`, err)}
                    {...register(`urls.${i}.value` as const)}
                  />
                </Field>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Product photos</CardTitle>
            <CardDescription>
              Your own photos give the best results. Images found on product pages are added
              automatically during extraction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dropzone />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context</CardTitle>
            <CardDescription>
              All optional. The AI uses this to set tone, pricing and audience.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field id="niche" label="Niche / category" optional>
              <Input
                {...fieldAria("niche")}
                placeholder="e.g. Home coffee gear"
                {...register("niche")}
              />
            </Field>
            <Field id="tone" label="Desired tone">
              <Controller
                control={control}
                name="tone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tone" aria-label="Desired tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field id="targetCustomer" label="Target customer" optional className="sm:col-span-2">
              <Input
                {...fieldAria("targetCustomer")}
                placeholder="e.g. Remote workers who brew one cup at a time"
                {...register("targetCustomer")}
              />
            </Field>
            <Field
              id="brandName"
              label="Brand name"
              optional
              help="Leave blank and we'll suggest six."
            >
              <Input {...fieldAria("brandName")} {...register("brandName")} />
            </Field>
            <Field id="currency" label="Currency" error={errors.currency?.message}>
              <Input
                {...fieldAria("currency", errors.currency?.message)}
                maxLength={3}
                className="uppercase"
                {...register("currency")}
              />
            </Field>
            <Field
              id="unitCost"
              label="Unit cost (product + shipping)"
              optional
              error={errors.unitCost?.message}
            >
              <Input
                inputMode="decimal"
                {...fieldAria("unitCost", errors.unitCost?.message)}
                {...register("unitCost")}
              />
            </Field>
            <Field
              id="targetMarginPct"
              label="Target margin %"
              optional
              error={errors.targetMarginPct?.message}
            >
              <Input
                inputMode="decimal"
                placeholder="e.g. 60"
                {...fieldAria("targetMarginPct", errors.targetMarginPct?.message)}
                {...register("targetMarginPct")}
              />
            </Field>
            <Field
              id="targetPrice"
              label="Target retail price"
              optional
              error={errors.targetPrice?.message}
            >
              <Input
                inputMode="decimal"
                {...fieldAria("targetPrice", errors.targetPrice?.message)}
                {...register("targetPrice")}
              />
            </Field>
            <Field id="shippingOrigin" label="Ships from" optional>
              <Input
                {...fieldAria("shippingOrigin")}
                placeholder="e.g. Los Angeles, USA"
                {...register("shippingOrigin")}
              />
            </Field>
            <Field
              id="targetMarket"
              label="Target market / country"
              help="Copy is written in this market's language."
            >
              <Input {...fieldAria("targetMarket")} {...register("targetMarket")} />
            </Field>
            <Field
              id="competitorUrls"
              label="Competitor store URLs"
              optional
              error={errors.competitorUrls?.message}
              help="One per line. Used as reference for positioning only."
              className="sm:col-span-2"
            >
              <Textarea
                rows={2}
                {...fieldAria("competitorUrls", errors.competitorUrls?.message)}
                {...register("competitorUrls")}
              />
            </Field>
            <Field
              id="notes"
              label="Anything else the AI should know"
              optional
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                placeholder="Materials, what makes it different, things to avoid saying…"
                {...fieldAria("notes")}
                {...register("notes")}
              />
            </Field>
          </CardContent>
        </Card>

        <Card className={errors.rightsAccepted ? "border-destructive" : undefined}>
          <CardContent className="flex items-start gap-3">
            <Controller
              control={control}
              name="rightsAccepted"
              render={({ field }) => (
                <Checkbox
                  id="rightsAccepted"
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                  aria-invalid={errors.rightsAccepted ? true : undefined}
                  aria-describedby="rights-help"
                  className="mt-0.5"
                />
              )}
            />
            <div className="grid gap-1">
              <label htmlFor="rightsAccepted" className="text-sm font-medium">
                I have the right to use these images and product information.
                <span className="text-destructive"> *</span>
              </label>
              <p id="rights-help" className="text-xs text-muted-foreground">
                Only use supplier content you&apos;re licensed to use. We timestamp this
                confirmation with the project.
                {ackAt ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-success">
                    <CheckCircle2Icon className="size-3" /> Confirmed {ackAt}
                  </span>
                ) : null}
              </p>
              {errors.rightsAccepted?.message ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.rightsAccepted.message}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {!view.project.inputs.urls.length && imageCount === 0 ? (
          <Alert variant="info">
            <ShieldCheckIcon />
            <AlertTitle>Tip</AlertTitle>
            <AlertDescription>
              <p>
                If a page blocks automated reading, upload screenshots or photos instead. We never
                try to get around bot protection, CAPTCHAs or logins.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
            {patch.isPending
              ? "Saving…"
              : patch.isSuccess
                ? "All changes saved"
                : "Changes save automatically"}
          </span>
          <Button type="button" variant="outline" onClick={handleSubmit((v) => save(v, false))}>
            <SaveIcon /> Save
          </Button>
          <Button type="submit" variant="ember" disabled={start.isPending || patch.isPending}>
            {start.isPending ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
            Save &amp; generate my store
          </Button>
        </div>
      </form>
    </StepShell>
  );
}
