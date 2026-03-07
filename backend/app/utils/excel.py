import pandas as pd

def export_excel(data, filename):
    df = pd.DataFrame(data)
    path = f"/tmp/{filename}.xlsx"
    df.to_excel(path, index=False)
    return path
