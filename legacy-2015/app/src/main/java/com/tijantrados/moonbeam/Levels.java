package com.tijantrados.moonbeam;

import android.app.Activity;
import android.content.Intent;
import android.support.v7.app.ActionBarActivity;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;


public class Levels extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_levels);
    }


    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        // Inflate the menu; this adds items to the action bar if it is present.
        getMenuInflater().inflate(R.menu.menu_levels, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        // Handle action bar item clicks here. The action bar will
        // automatically handle clicks on the Home/Up button, so long
        // as you specify a parent activity in AndroidManifest.xml.
        int id = item.getItemId();

        //noinspection SimplifiableIfStatement
        if (id == R.id.action_settings) {
            return true;
        }

        return super.onOptionsItemSelected(item);
    }

    public void level1(View view){
        startActivity(new Intent(Levels.this, LEVEL1.class));
    }

    public void level2(View view){
        startActivity(new Intent(Levels.this, LEVEL2.class));
    }

    public void level3(View view){
        startActivity(new Intent(Levels.this, LEVEL3.class));
    }

    public void level4(View view){
        startActivity(new Intent(Levels.this, LEVEL4.class));
    }

    public void level5(View view){
        startActivity(new Intent(Levels.this, LEVEL5.class));
    }

    public void level6(View view){
        startActivity(new Intent(Levels.this, LEVEL6.class));
    }

    public void level7(View view){
        startActivity(new Intent(Levels.this, LEVEL7.class));
    }

    public void level8(View view){
        startActivity(new Intent(Levels.this, LEVEL8.class));
    }

    public void level9(View view){
        startActivity(new Intent(Levels.this, LEVEL9.class));
    }
}
