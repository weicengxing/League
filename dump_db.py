#!/usr/bin/env python3
"""
数据库查看脚本 - 打印数据库所有表的所有数据
"""

import sqlite3
from pathlib import Path

# 数据库路径
DB_PATH = Path(__file__).resolve().parent / "data" / "alliance.db"


def get_all_tables(connection):
    """获取数据库中所有表名"""
    cursor = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    return [row[0] for row in cursor.fetchall()]


def get_table_columns(connection, table_name):
    """获取表的列名"""
    cursor = connection.execute(f"PRAGMA table_info({table_name})")
    return [row[1] for row in cursor.fetchall()]


def get_table_data(connection, table_name):
    """获取表的所有数据"""
    cursor = connection.execute(f"SELECT * FROM {table_name}")
    columns = get_table_columns(connection, table_name)
    rows = cursor.fetchall()
    return columns, rows


def print_table(connection, table_name):
    """打印单个表的数据"""
    columns, rows = get_table_data(connection, table_name)
    
    print(f"\n{'='*80}")
    print(f"表名: {table_name}")
    print(f"记录数: {len(rows)}")
    print(f"{'='*80}")
    
    if not rows:
        print("  (空表)")
        return
    
    # 打印表头
    header = " | ".join(columns)
    print(f"\n字段: {header}")
    print("-" * len(header))
    
    # 打印数据行
    for row in rows:
        row_str = " | ".join(str(value) if value is not None else "NULL" for value in row)
        print(f"  {row_str}")


def main():
    if not DB_PATH.exists():
        print(f"错误: 数据库文件不存在: {DB_PATH}")
        return
    
    print(f"连接到数据库: {DB_PATH}")
    
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    
    try:
        tables = get_all_tables(connection)
        print(f"\n找到 {len(tables)} 个表: {', '.join(tables)}")
        
        for table in tables:
            print_table(connection, table)
        
        print(f"\n{'='*80}")
        print("全部表打印完毕")
        print(f"{'='*80}")
        
    finally:
        connection.close()


if __name__ == "__main__":
    main()
