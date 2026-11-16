-- Finance routes authorize access and read balances through their server client.
revoke all privileges on table finance.v_charge_balances, finance.v_student_balance_summary from authenticated;
