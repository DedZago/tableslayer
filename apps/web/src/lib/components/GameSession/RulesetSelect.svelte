<script lang="ts">
  import { FormControl, Select } from '@tableslayer/ui';
  import { isRuleset, RULESET_LABELS, RULESETS, type Ruleset } from '@tableslayer/stage';

  let {
    value,
    onChange,
    disabled = false
  }: {
    value: Ruleset;
    onChange: (ruleset: Ruleset) => void;
    disabled?: boolean;
  } = $props();

  const options = RULESETS.map((ruleset) => ({ label: RULESET_LABELS[ruleset], value: ruleset }));
</script>

<FormControl label="Ruleset" name="ruleset">
  {#snippet input({ inputProps })}
    <Select
      {...inputProps}
      {disabled}
      selected={[value]}
      {options}
      onSelectedChange={([next]) => {
        if (isRuleset(next) && next !== value) onChange(next);
      }}
      data-testid="rulesetSelect"
    />
  {/snippet}
</FormControl>
