#!/usr/bin/env python3
"""
KhelSetu Squad Scoring Simulation Harness (Simulation-Only).
Demonstrates the mathematical resilience and fairness of mean-based goal completion
under diverse participation profiles (dormant members, comeback bonuses, high performers).
"""
import random, statistics

def simulate_squad(members=6, weeks=8, dormant_count=1, comeback_prob=0.3):
    """
    Simulates squad scoring over time:
    - Normal members target: 100% of individual goal
    - Dormant members: 0% completion
    - Comeback members: recover from <25% to >=50%
    """
    history = []
    prev_completions = [0.0] * members
    
    for w in range(weeks):
        completions = []
        for i in range(members):
            if i < dormant_count:
                # Dormant member: might recover with comeback_prob
                if random.random() < comeback_prob:
                    comp = random.uniform(0.5, 0.9)
                else:
                    comp = random.uniform(0.0, 0.1)
            else:
                # Active member: adheres between 70% and 100%
                comp = min(1.0, random.gauss(0.85, 0.12))
            completions.append(comp)
        
        # Calculate comeback bonus
        comebacks = sum(1 for i in range(members) if prev_completions[i] < 0.25 and completions[i] >= 0.5)
        bonus = min(10.0, 2.0 * comebacks)
        
        mean_pct = sum(completions) / members * 100.0
        final_score = round(mean_pct + bonus, 1)
        
        history.append({
            "week": w + 1,
            "mean_completion": round(mean_pct, 1),
            "comebacks": comebacks,
            "bonus": bonus,
            "final_score": final_score,
            "completions": [round(c * 100) for c in completions]
        })
        prev_completions = completions
    
    return history

def main():
    print("================================================================")
    print("  KhelSetu Squad Fairness Simulation (SIMULATION-ONLY)")
    print("================================================================\n")
    
    random.seed(26196)
    sims = [
        ("Squad A: All Active (6 members)", 6, 0, 0.0),
        ("Squad B: 1 Dormant Member (5 active, 1 inactive)", 6, 1, 0.1),
        ("Squad C: 1 Member Comeback (inactive member recovers)", 6, 1, 0.9),
        ("Squad D: 2 Inactive Members (4 active, 2 inactive)", 6, 2, 0.2)
    ]
    
    for name, m, d, cb in sims:
        hist = simulate_squad(members=m, weeks=4, dormant_count=d, comeback_prob=cb)
        scores = [h["final_score"] for h in hist]
        print(f"Profile: {name}")
        print(f"  Week Scores: {scores}")
        print(f"  Average Score: {statistics.mean(scores):.1f}/100 (StdDev: {statistics.stdev(scores):.1f})")
        print(f"  Sample Week 4 Member Completions: {hist[-1]['completions']}%\n")

if __name__ == "__main__":
    main()
