import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import create_users_table
import create_config_tables
import create_split_config_tables
import create_machine_tables
import create_production_tables
import build_reports_dataset

def main():
    print("==================================================")
    print("Starting full database setup & table provisioning...")
    print("==================================================")

    # Reordered to ensure create_machine_tables runs FIRST since it drops other tables during its own cleanup step.
    scripts = [
        ("Machine & Metrics Tables", create_machine_tables),
        ("Users Table", create_users_table),
        ("Legacy Config Tables", create_config_tables),
        ("Split Config Tables", create_split_config_tables),
        ("Production Summary & Part Tables", create_production_tables),
        ("Reports & ETL Generation", build_reports_dataset),
    ]

    for name, module in scripts:
        print(f"\n---> Running {name} Setup...")
        try:
            module.main()
        except Exception as e:
            print(f"FAILED during {name} setup. Expected? Check logs.")
            print(f"Error: {e}")

    print("\n==================================================")
    print("FULL DATABASE SETUP COMPLETE!")
    print("==================================================")

if __name__ == "__main__":
    main()
