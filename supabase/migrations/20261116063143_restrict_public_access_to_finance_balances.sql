-- Finance balances and reductions must not be available to anonymous clients.
revoke all privileges on table finance.student_charge_adjustments from public, anon, authenticated;
revoke all privileges on table finance.v_charge_balances, finance.v_student_balance_summary from public, anon;
