from decimal import Decimal

USD_TO_INR = Decimal("88.00")


class CostCalculator:

    @staticmethod
    def calculate(
        *,
        input_tokens: int,
        output_tokens: int,
        input_cost_per_million: float,
        output_cost_per_million: float
    ) -> tuple[float, float]:

        input_cost = (
            Decimal(input_tokens)
            / Decimal(1_000_000)
        ) * Decimal(str(input_cost_per_million))

        output_cost = (
            Decimal(output_tokens)
            / Decimal(1_000_000)
        ) * Decimal(str(output_cost_per_million))

        total_usd = input_cost + output_cost

        total_inr = total_usd * USD_TO_INR

        return (
            round(float(total_usd), 8),
            round(float(total_inr), 6)
        )