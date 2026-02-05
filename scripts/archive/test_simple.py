import sys
print("stdout works")
print("stderr works", file=sys.stderr)
import pandas
print(f"pandas version: {pandas.__version__}")
try:
    import nba_api
    print(f"nba_api version: {nba_api.__version__}")
except Exception as e:
    print(f"nba_api load fail: {e}")
